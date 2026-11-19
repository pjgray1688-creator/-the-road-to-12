-- Standardise gym-entry PINs on six numeric digits.
-- QR tokens and shared Club station sign-in PINs are separate credentials.
-- Existing eligible access holders receive a fresh six-digit PIN atomically;
-- ineligible or unverified records are revoked and are not reissued.
begin;

lock table public.club_access_credentials in share row exclusive mode;

alter table public.club_access_credentials
  add column if not exists pin_length smallint;
comment on column public.club_access_credentials.pin_length is
  'Digit count for PIN credentials; active gym-entry PINs are six digits, rotated legacy credentials retain their former length.';

do $preflight$
declare k bytea;
begin
  select key_material into k from public.club_access_keyring where singleton;
  if k is null then raise exception 'Access credential keyring is unavailable'; end if;
  if exists (
    select 1 from public.club_access_credentials c
    where c.credential_type='pin' and c.status='active'
      and (not c.permanent or c.secret_ciphertext is null
        or extensions.pgp_sym_decrypt(c.secret_ciphertext,encode(k,'hex')) !~ '^[0-9]{6}([0-9]{2})?$')
  ) then
    raise exception 'Active PIN credentials do not match the expected legacy format; review required';
  end if;
end;
$preflight$;

-- Preserve the legacy length for history and make the transition auditable.
do $backfill$
declare k bytea;
begin
  select key_material into k from public.club_access_keyring where singleton;
  update public.club_access_credentials set pin_length=null
    where credential_type<>'pin' and pin_length is not null;
  update public.club_access_credentials c
    set pin_length=length(extensions.pgp_sym_decrypt(c.secret_ciphertext,encode(k,'hex')))
    where c.credential_type='pin' and c.status='active'
      and c.pin_length is distinct from length(extensions.pgp_sym_decrypt(c.secret_ciphertext,encode(k,'hex')));
end;
$backfill$;

create or replace function public.club_access_credential_hash(p_type text,p_value text)
returns bytea language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare k bytea; v text;
begin
  select key_material into k from public.club_access_keyring where singleton;
  if k is null or p_type not in ('pin','qr','wallet','nfc','legacy_member_reference','barcode') then
    raise exception 'Credential hashing is unavailable' using errcode='22023';
  end if;
  if p_type='pin' then
    if p_value is null or p_value !~ '^[0-9]{6}$' then return null; end if;
    v:=p_value;
  elsif p_type in ('legacy_member_reference','barcode') then
    v:=lower(btrim(coalesce(p_value,'')));
  else
    v:=btrim(coalesce(p_value,''));
  end if;
  if v='' then raise exception 'Credential is empty' using errcode='22023'; end if;
  return case when p_type in ('pin','qr','wallet','nfc')
    then extensions.hmac(convert_to(v,'UTF8'),k,'sha256')
    else extensions.digest(v,'sha256') end;
end;
$$;

create or replace function public.club_ensure_person_access_credentials(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare
  k bytea; pin text; token text; pin_row public.club_access_credentials%rowtype;
  qr_row public.club_access_credentials%rowtype; candidate bigint; random_bytes bytea;
  attempts integer:=0; customer public.club_customers%rowtype;
  projection public.club_member_access_projection%rowtype; verified boolean:=false;
begin
  select * into customer from public.club_customers
    where id=p_customer_id and organisation_id=p_organisation_id for share;
  if not found then raise exception 'Access identity is unavailable' using errcode='P0002'; end if;

  -- A PIN is issued only to a linked, verified R12 identity with current
  -- authoritative access. The access-decision path still applies venue,
  -- age, induction, suspension and other live restrictions on every scan.
  if customer.user_id is null then
    return jsonb_build_object('pin',null,'qrToken',null,'pinCredentialId',null,'qrCredentialId',null);
  end if;
  select exists(select 1 from auth.users u where u.id=customer.user_id
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) into verified;
  if not verified then
    return jsonb_build_object('pin',null,'qrToken',null,'pinCredentialId',null,'qrCredentialId',null);
  end if;
  projection:=public.club_refresh_customer_access_projection(p_organisation_id,p_customer_id);
  if not coalesce(projection.access_allowed,false)
    or (projection.valid_from is not null and projection.valid_from>now())
    or (projection.valid_until is not null and projection.valid_until<=now()) then
    return jsonb_build_object('pin',null,'qrToken',null,'pinCredentialId',null,'qrCredentialId',null);
  end if;

  select key_material into k from public.club_access_keyring where singleton;
  if k is null then raise exception 'Access credential keyring is unavailable'; end if;
  select * into pin_row from public.club_access_credentials
    where organisation_id=p_organisation_id and customer_id=p_customer_id
      and credential_type='pin' and permanent and status='active' for update;
  if found then
    pin:=extensions.pgp_sym_decrypt(pin_row.secret_ciphertext,encode(k,'hex'));
    if pin_row.secret_ciphertext is null or pin_row.pin_length is distinct from 6
      or pin is null or pin !~ '^[0-9]{6}$'
      or pin_row.credential_hash is distinct from extensions.hmac(convert_to(pin,'UTF8'),k,'sha256') then
      update public.club_access_credentials set status='revoked',revoked_at=now()
        where id=pin_row.id;
      pin_row:=null;
    end if;
  end if;
  if pin_row.id is null then
    loop
      attempts:=attempts+1;
      if attempts>256 then raise exception 'Could not allocate a unique access PIN' using errcode='54000'; end if;
      random_bytes:=extensions.gen_random_bytes(4);
      candidate:=(get_byte(random_bytes,0)::bigint<<24)
        +(get_byte(random_bytes,1)::bigint<<16)
        +(get_byte(random_bytes,2)::bigint<<8)+get_byte(random_bytes,3);
      -- Rejection sampling avoids modulo bias over the 000000–999999 range.
      if candidate>=4294000000 then continue; end if;
      pin:=lpad((candidate%1000000)::text,6,'0');
      begin
        insert into public.club_access_credentials
          (organisation_id,customer_id,credential_type,credential_hash,secret_ciphertext,
           display_suffix,permanent,valid_from,status,pin_length)
        values(p_organisation_id,p_customer_id,'pin',
          extensions.hmac(convert_to(pin,'UTF8'),k,'sha256'),
          extensions.pgp_sym_encrypt(pin,encode(k,'hex'),'cipher-algo=aes256'),
          right(pin,2),true,now(),'active',6)
        returning * into pin_row;
        exit;
      exception when unique_violation then
        select * into pin_row from public.club_access_credentials
          where organisation_id=p_organisation_id and customer_id=p_customer_id
            and credential_type='pin' and permanent and status='active';
        if found then exit; end if;
      end;
    end loop;
  end if;

  select * into qr_row from public.club_access_credentials
    where organisation_id=p_organisation_id and customer_id=p_customer_id
      and credential_type='qr' and permanent and status='active' for update;
  if not found then
    loop
      token:='R12-'||upper(encode(extensions.gen_random_bytes(16),'hex'));
      begin
        insert into public.club_access_credentials
          (organisation_id,customer_id,credential_type,credential_hash,secret_ciphertext,
           display_suffix,permanent,valid_from,status)
        values(p_organisation_id,p_customer_id,'qr',
          extensions.hmac(convert_to(token,'UTF8'),k,'sha256'),
          extensions.pgp_sym_encrypt(token,encode(k,'hex'),'cipher-algo=aes256'),
          right(token,6),true,now(),'active') returning * into qr_row;
        exit;
      exception when unique_violation then
        select * into qr_row from public.club_access_credentials
          where organisation_id=p_organisation_id and customer_id=p_customer_id
            and credential_type='qr' and permanent and status='active';
        if found then exit; end if;
      end;
    end loop;
  end if;
  return jsonb_build_object(
    'pin',extensions.pgp_sym_decrypt(pin_row.secret_ciphertext,encode(k,'hex')),
    'qrToken',extensions.pgp_sym_decrypt(qr_row.secret_ciphertext,encode(k,'hex')),
    'pinCredentialId',pin_row.id,'qrCredentialId',qr_row.id);
end;
$$;

create or replace function public.club_get_my_access_pass(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare c public.club_customers%rowtype; credentials jsonb;
  projection public.club_member_access_projection%rowtype; verified boolean:=false;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into c from public.club_customers
    where organisation_id=p_organisation_id and user_id=auth.uid();
  if not found then raise exception 'Member identity is unavailable' using errcode='P0002'; end if;
  projection:=public.club_refresh_customer_access_projection(p_organisation_id,c.id);
  select exists(select 1 from auth.users u where u.id=auth.uid()
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) into verified;
  if not verified or not coalesce(projection.access_allowed,false)
    or (projection.valid_from is not null and projection.valid_from>now())
    or (projection.valid_until is not null and projection.valid_until<=now()) then
    return jsonb_build_object('pin','','qrToken','','customerId',c.id,'displayName',c.display_name,
      'accessAllowed',false,'accessState',case when not verified then 'inactive' else projection.access_state end,
      'reason',case when not verified then 'identity_unverified' else projection.reason end,
      'validFrom',projection.valid_from,'validUntil',projection.valid_until,
      'graceState',projection.grace_state,'lastRecalculated',projection.recalculated_at);
  end if;
  credentials:=public.club_ensure_person_access_credentials(p_organisation_id,c.id);
  return credentials||jsonb_build_object('customerId',c.id,'displayName',c.display_name,
    'accessAllowed',true,'accessState',projection.access_state,'reason',projection.reason,
    'validFrom',projection.valid_from,'validUntil',projection.valid_until,
    'graceState',projection.grace_state,'lastRecalculated',projection.recalculated_at);
end;
$$;

create or replace function public.club_issue_customer_access_pass(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then
    raise exception 'Access pass issue is not permitted' using errcode='42501';
  end if;
  return public.club_ensure_person_access_credentials(p_organisation_id,p_customer_id);
end;
$$;

-- Reissue only PINs that were active before this migration and whose exact
-- linked account is verified and still passes the existing access projection.
create temporary table r12_pin_rotation(
  organisation_id uuid not null, customer_id uuid not null,
  old_credential_id uuid not null, old_length smallint not null,
  primary key(organisation_id,customer_id)
) on commit drop;
insert into r12_pin_rotation(organisation_id,customer_id,old_credential_id,old_length)
select organisation_id,customer_id,id,pin_length from public.club_access_credentials
where credential_type='pin' and permanent and status='active';

update public.club_access_credentials set status='revoked',revoked_at=now()
where credential_type='pin' and status='active' and pin_length=8;

alter table public.club_access_credentials
  drop constraint if exists club_access_pin_length_chk;
alter table public.club_access_credentials
  add constraint club_access_pin_length_chk
  check (credential_type<>'pin' or status<>'active' or (pin_length is not null and pin_length=6));

do $rotate$
declare r record; p public.club_member_access_projection%rowtype;
  new_id uuid; verified boolean; eligible_count integer:=0; issued_count integer:=0; k bytea;
begin
  select key_material into k from public.club_access_keyring where singleton;
  if k is null then raise exception 'Access credential keyring is unavailable'; end if;
  for r in select * from r12_pin_rotation order by organisation_id,customer_id loop
    p:=public.club_refresh_customer_access_projection(r.organisation_id,r.customer_id);
    select exists(select 1 from public.club_customers c join auth.users u on u.id=c.user_id
      where c.id=r.customer_id and c.organisation_id=r.organisation_id
        and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) into verified;
    if verified and coalesce(p.access_allowed,false)
      and (p.valid_from is null or p.valid_from<=now())
      and (p.valid_until is null or p.valid_until>now()) then
      eligible_count:=eligible_count+1;
      perform public.club_ensure_person_access_credentials(r.organisation_id,r.customer_id);
      select id into new_id from public.club_access_credentials
        where organisation_id=r.organisation_id and customer_id=r.customer_id
          and credential_type='pin' and permanent and status='active' and pin_length=6;
      if new_id is null or not exists(select 1 from public.club_access_credentials c
        where c.id=new_id and c.secret_ciphertext is not null
          and extensions.pgp_sym_decrypt(c.secret_ciphertext,encode(k,'hex')) ~ '^[0-9]{6}$') then
        raise exception 'Eligible PIN rotation did not produce a valid six-digit credential';
      end if;
      if r.old_length=8 then
        update public.club_access_credentials set reissued_from=r.old_credential_id where id=new_id;
      end if;
      issued_count:=issued_count+1;
    else
      update public.club_access_credentials set status='revoked',revoked_at=now()
        where id=r.old_credential_id and status='active';
    end if;
  end loop;
  if issued_count<>eligible_count then raise exception 'PIN rotation count mismatch'; end if;
  if exists(select 1 from r12_pin_rotation rot join public.club_access_credentials old on old.id=rot.old_credential_id
    where rot.old_length=8 and old.status<>'revoked') then raise exception 'A legacy PIN remained active'; end if;
  if exists(select 1 from public.club_access_credentials where credential_type='pin'
    and status='active' and pin_length is distinct from 6) then raise exception 'A non-six-digit PIN remained active'; end if;
end;
$rotate$;

revoke all on function public.club_access_credential_hash(text,text),
  public.club_ensure_person_access_credentials(uuid,uuid) from public,anon,authenticated;
revoke all on function public.club_get_my_access_pass(uuid) from public,anon,authenticated;
revoke all on function public.club_issue_customer_access_pass(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_get_my_access_pass(uuid) to authenticated;
grant execute on function public.club_issue_customer_access_pass(uuid,uuid) to authenticated;

commit;
