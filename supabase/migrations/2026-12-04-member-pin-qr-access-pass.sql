-- Permanent person credentials and fast access projection.
-- Review-only: no live device is provisioned and no hardware is contacted.

alter table public.club_access_credentials drop constraint if exists club_access_credentials_credential_type_check;
alter table public.club_access_credentials add constraint club_access_credentials_credential_type_check
  check (credential_type in ('legacy_member_reference','pin','qr','barcode','wallet','nfc'));
alter table public.club_access_credentials
  add column if not exists secret_ciphertext bytea,
  add column if not exists permanent boolean not null default false,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists reissued_from uuid references public.club_access_credentials(id) on delete set null;
create unique index if not exists club_access_one_permanent_type_uq on public.club_access_credentials(organisation_id,customer_id,credential_type) where permanent and status='active';
create unique index if not exists club_access_person_token_uq on public.club_access_credentials(credential_type,credential_hash) where credential_type in ('pin','qr','wallet','nfc') and status='active';

create table if not exists public.club_access_keyring (
  singleton boolean primary key default true check(singleton), key_material bytea not null check(octet_length(key_material)=32), created_at timestamptz not null default now()
);
alter table public.club_access_keyring enable row level security;
revoke all on public.club_access_keyring from public,anon,authenticated;
insert into public.club_access_keyring(singleton,key_material) values(true,extensions.gen_random_bytes(32)) on conflict(singleton) do nothing;

alter table public.club_locations add column if not exists access_mode text not null default 'DISABLED';
alter table public.club_locations drop constraint if exists club_locations_access_mode_check;
alter table public.club_locations add constraint club_locations_access_mode_check check(access_mode in ('CHECKIN_ONLY','DOOR_CONTROLLED','DISABLED'));
update public.club_locations l set access_mode='CHECKIN_ONLY'
from public.club_organisations o where o.id=l.organisation_id and o.slug='madhouse-gym' and lower(l.name) in ('rotherham','carlton') and l.access_mode='DISABLED';

create table if not exists public.club_member_access_projection (
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  customer_id uuid not null, membership_id uuid, access_allowed boolean not null default false,
  access_state text not null check(access_state in ('active','grace','action_required','not_started','expired','cancelled','inactive','no_access')),
  reason text not null, valid_from timestamptz, valid_until timestamptz,
  grace_state text, access_scope text, location_ids uuid[] not null default '{}',
  membership_source text, recalculated_at timestamptz not null default now(),
  primary key(organisation_id,customer_id),
  foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete cascade,
  foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete set null (membership_id)
);
create index if not exists club_member_access_projection_fast_idx on public.club_member_access_projection(organisation_id,customer_id,access_allowed,valid_from,valid_until);
alter table public.club_member_access_projection enable row level security;
revoke all on public.club_member_access_projection from public,anon,authenticated;

alter table public.club_access_decisions
  add column if not exists access_state text,
  add column if not exists attendance_recorded boolean not null default false,
  add column if not exists bounce_of uuid references public.club_access_decisions(id) on delete set null,
  add column if not exists location_mode text,
  add column if not exists unlock_permitted boolean not null default false;

create or replace function public.club_access_credential_hash(p_type text,p_value text)
returns bytea language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare k bytea; v text;
begin
 select key_material into k from public.club_access_keyring where singleton;
 if k is null or p_type not in ('pin','qr','wallet','nfc','legacy_member_reference','barcode') then raise exception 'Credential hashing is unavailable' using errcode='22023'; end if;
 v:=case when p_type='pin' then regexp_replace(coalesce(p_value,''),'[^0-9]','','g') when p_type in ('legacy_member_reference','barcode') then lower(btrim(coalesce(p_value,''))) else btrim(coalesce(p_value,'')) end;
 if v='' then raise exception 'Credential is empty' using errcode='22023'; end if;
 return case when p_type in ('pin','qr','wallet','nfc') then extensions.hmac(v,k,'sha256') else extensions.digest(v,'sha256') end;
end; $$;

create or replace function public.club_ensure_person_access_credentials(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare k bytea; pin text; token text; pin_row public.club_access_credentials%rowtype; qr_row public.club_access_credentials%rowtype; candidate bigint; random_bytes bytea;
begin
 select key_material into k from public.club_access_keyring where singleton;
 if k is null or not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Access identity is unavailable' using errcode='P0002'; end if;
 select * into pin_row from public.club_access_credentials where organisation_id=p_organisation_id and customer_id=p_customer_id and credential_type='pin' and permanent and status='active' for update;
 if not found then
  loop
   random_bytes:=extensions.gen_random_bytes(4); candidate:=((get_byte(random_bytes,0)::bigint<<24)+(get_byte(random_bytes,1)::bigint<<16)+(get_byte(random_bytes,2)::bigint<<8)+get_byte(random_bytes,3))%100000000;
   pin:=lpad(candidate::text,8,'0');
   begin
    insert into public.club_access_credentials(organisation_id,customer_id,credential_type,credential_hash,secret_ciphertext,display_suffix,permanent,valid_from,status)
      values(p_organisation_id,p_customer_id,'pin',extensions.hmac(pin,k,'sha256'),extensions.pgp_sym_encrypt(pin,encode(k,'hex'),'cipher-algo=aes256'),right(pin,2),true,now(),'active') returning * into pin_row;
    exit;
   exception when unique_violation then
    select * into pin_row from public.club_access_credentials where organisation_id=p_organisation_id and customer_id=p_customer_id and credential_type='pin' and permanent and status='active';
    if found then exit; end if;
   end;
  end loop;
 end if;
 select * into qr_row from public.club_access_credentials where organisation_id=p_organisation_id and customer_id=p_customer_id and credential_type='qr' and permanent and status='active' for update;
 if not found then
  loop
   token:='R12-'||upper(encode(extensions.gen_random_bytes(16),'hex'));
   begin
    insert into public.club_access_credentials(organisation_id,customer_id,credential_type,credential_hash,secret_ciphertext,display_suffix,permanent,valid_from,status)
      values(p_organisation_id,p_customer_id,'qr',extensions.hmac(token,k,'sha256'),extensions.pgp_sym_encrypt(token,encode(k,'hex'),'cipher-algo=aes256'),right(token,6),true,now(),'active') returning * into qr_row;
    exit;
   exception when unique_violation then
    select * into qr_row from public.club_access_credentials where organisation_id=p_organisation_id and customer_id=p_customer_id and credential_type='qr' and permanent and status='active';
    if found then exit; end if;
   end;
  end loop;
 end if;
 return jsonb_build_object('pin',extensions.pgp_sym_decrypt(pin_row.secret_ciphertext,encode(k,'hex')),'qrToken',extensions.pgp_sym_decrypt(qr_row.secret_ciphertext,encode(k,'hex')),'pinCredentialId',pin_row.id,'qrCredentialId',qr_row.id);
end; $$;

create or replace function public.club_refresh_customer_access_projection(p_organisation_id uuid,p_customer_id uuid)
returns public.club_member_access_projection language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; selected record; suspended boolean:=false; grace text; state text:='no_access'; why text:='no_membership'; allowed boolean:=false; result public.club_member_access_projection%rowtype;
begin
 select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
 if not found then delete from public.club_member_access_projection where organisation_id=p_organisation_id and customer_id=p_customer_id; return null; end if;
 select candidate.* into selected from (
  select m.id,m.status,m.starts_at,m.ends_at,m.source,e.scope,e.location_ids
  from public.club_memberships m
  join public.club_membership_holders h on h.membership_id=m.id and h.organisation_id=m.organisation_id
  join lateral (
   select g.scope,g.location_ids from public.club_entitlement_grants g where c.user_id is not null and g.organisation_id=m.organisation_id and g.membership_id=m.id and g.user_id=c.user_id and g.entitlement_key='gym_access'
   union all
   select pe.scope,pe.location_ids from public.club_product_entitlements pe where c.user_id is null and pe.product_id=m.product_id and pe.entitlement_key='gym_access'
  ) e on true
  where m.organisation_id=p_organisation_id and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
  union all
  select null::uuid,'active'::text,g.starts_at,g.ends_at,g.source,g.scope,g.location_ids
  from public.club_entitlement_grants g where c.user_id is not null and g.organisation_id=p_organisation_id and g.user_id=c.user_id and g.membership_id is null and g.entitlement_key='gym_access'
 ) candidate
 order by (candidate.status='active' and candidate.starts_at<=now() and (candidate.ends_at is null or candidate.ends_at>now())) desc,(candidate.status='active') desc,candidate.starts_at desc,candidate.id nulls last limit 1;
 if found then
  select exists(
   select 1 from public.club_membership_payment_access_suspensions s
   join public.club_membership_billing_policies bp on bp.organisation_id=s.organisation_id and bp.access_suspension_enabled
   where s.organisation_id=p_organisation_id and s.membership_id=selected.id and s.active
  ) into suspended;
  select o.state into grace from public.club_membership_billing_obligations o where o.organisation_id=p_organisation_id and o.membership_id=selected.id order by o.next_due_at desc limit 1;
  if selected.status='cancelled' then state:='cancelled'; why:='membership_cancelled';
  elsif selected.status<>'active' then state:=case when selected.status='expired' then 'expired' else 'inactive' end; why:=case when selected.status='expired' then 'membership_expired' else 'membership_inactive' end;
  elsif selected.starts_at>now() then state:='not_started'; why:='membership_not_started';
  elsif selected.ends_at is not null and selected.ends_at<=now() then state:='expired'; why:='membership_expired';
  elsif suspended then state:='action_required'; why:='payment_action_required';
  else allowed:=true; state:=case when grace in ('failed','grace','retry_scheduled','payment_pending','due') then 'grace' else 'active' end; why:=case when state='grace' then 'billing_grace' else 'active_entitlement' end; end if;
 end if;
 insert into public.club_member_access_projection(organisation_id,customer_id,membership_id,access_allowed,access_state,reason,valid_from,valid_until,grace_state,access_scope,location_ids,membership_source,recalculated_at)
 values(p_organisation_id,p_customer_id,selected.id,allowed,state,why,selected.starts_at,selected.ends_at,grace,selected.scope,coalesce(selected.location_ids,'{}'),selected.source,now())
 on conflict(organisation_id,customer_id) do update set membership_id=excluded.membership_id,access_allowed=excluded.access_allowed,access_state=excluded.access_state,reason=excluded.reason,valid_from=excluded.valid_from,valid_until=excluded.valid_until,grace_state=excluded.grace_state,access_scope=excluded.access_scope,location_ids=excluded.location_ids,membership_source=excluded.membership_source,recalculated_at=excluded.recalculated_at returning * into result;
 return result;
end; $$;

create or replace function public.club_refresh_membership_access_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare org uuid:=coalesce(new.organisation_id,old.organisation_id); mid uuid:=coalesce(new.id,old.id); h record;
begin
 for h in select c.id from public.club_membership_holders mh join public.club_customers c on c.organisation_id=org and (c.id=mh.customer_id or c.user_id=mh.user_id) where mh.membership_id=mid loop perform public.club_refresh_customer_access_projection(org,h.id); end loop;
 return coalesce(new,old);
end; $$;
drop trigger if exists club_membership_access_projection_refresh on public.club_memberships;
create trigger club_membership_access_projection_refresh after insert or update of status,starts_at,ends_at,product_id or delete on public.club_memberships for each row execute function public.club_refresh_membership_access_projection();

create or replace function public.club_refresh_holder_access_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record;
begin
 if tg_op<>'DELETE' then
  for r in select distinct c.organisation_id,c.id from public.club_customers c where c.organisation_id=new.organisation_id and (c.id=new.customer_id or c.user_id=new.user_id) loop perform public.club_refresh_customer_access_projection(r.organisation_id,r.id); perform public.club_ensure_person_access_credentials(r.organisation_id,r.id); end loop;
 end if;
 if tg_op<>'INSERT' then
  for r in select distinct c.organisation_id,c.id from public.club_customers c where c.organisation_id=old.organisation_id and (c.id=old.customer_id or c.user_id=old.user_id) loop perform public.club_refresh_customer_access_projection(r.organisation_id,r.id); end loop;
 end if;
 return coalesce(new,old);
end; $$;
drop trigger if exists club_holder_access_projection_refresh on public.club_membership_holders;
create trigger club_holder_access_projection_refresh after insert or update or delete on public.club_membership_holders for each row execute function public.club_refresh_holder_access_projection();

create or replace function public.club_refresh_billing_access_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare org uuid:=coalesce(new.organisation_id,old.organisation_id); mid uuid:=coalesce(new.membership_id,old.membership_id); h record;
begin
 for h in select c.id from public.club_membership_holders mh join public.club_customers c on c.organisation_id=org and (c.id=mh.customer_id or c.user_id=mh.user_id) where mh.membership_id=mid loop perform public.club_refresh_customer_access_projection(org,h.id); end loop;
 return coalesce(new,old);
end; $$;
drop trigger if exists club_obligation_access_projection_refresh on public.club_membership_billing_obligations;
create trigger club_obligation_access_projection_refresh after insert or update of state,grace_started_at,recovery_exhausted_at or delete on public.club_membership_billing_obligations for each row execute function public.club_refresh_billing_access_projection();
drop trigger if exists club_suspension_access_projection_refresh on public.club_membership_payment_access_suspensions;
create trigger club_suspension_access_projection_refresh after insert or update of active,cleared_at or delete on public.club_membership_payment_access_suspensions for each row execute function public.club_refresh_billing_access_projection();

create or replace function public.club_refresh_policy_access_projections()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare org uuid:=coalesce(new.organisation_id,old.organisation_id); c record;
begin
 for c in select customer_id from public.club_member_access_projection where organisation_id=org loop
  perform public.club_refresh_customer_access_projection(org,c.customer_id);
 end loop;
 return coalesce(new,old);
end; $$;
drop trigger if exists club_policy_access_projection_refresh on public.club_membership_billing_policies;
create trigger club_policy_access_projection_refresh after insert or update of access_suspension_enabled,grace_period_days,suspend_after_days,max_retries,retry_intervals_days or delete on public.club_membership_billing_policies for each row execute function public.club_refresh_policy_access_projections();

create or replace function public.club_refresh_product_access_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record;
begin
 if tg_op<>'DELETE' then
  for r in select distinct c.organisation_id,c.id from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id join public.club_customers c on c.organisation_id=m.organisation_id and (c.id=h.customer_id or c.user_id=h.user_id) where m.product_id=new.product_id loop perform public.club_refresh_customer_access_projection(r.organisation_id,r.id); end loop;
 end if;
 if tg_op<>'INSERT' then
  for r in select distinct c.organisation_id,c.id from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id join public.club_customers c on c.organisation_id=m.organisation_id and (c.id=h.customer_id or c.user_id=h.user_id) where m.product_id=old.product_id loop perform public.club_refresh_customer_access_projection(r.organisation_id,r.id); end loop;
 end if;
 return coalesce(new,old);
end; $$;
drop trigger if exists club_product_entitlement_access_projection_refresh on public.club_product_entitlements;
create trigger club_product_entitlement_access_projection_refresh after insert or update or delete on public.club_product_entitlements for each row execute function public.club_refresh_product_access_projection();

create or replace function public.club_refresh_grant_access_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record;
begin
 if tg_op<>'DELETE' then
  if new.entitlement_key='gym_access' then
   for r in select c.organisation_id,c.id from public.club_customers c where c.organisation_id=new.organisation_id and c.user_id=new.user_id loop
    perform public.club_refresh_customer_access_projection(r.organisation_id,r.id); perform public.club_ensure_person_access_credentials(r.organisation_id,r.id);
   end loop;
  end if;
 end if;
 if tg_op<>'INSERT' then
  if old.entitlement_key='gym_access' then
   for r in select c.organisation_id,c.id from public.club_customers c where c.organisation_id=old.organisation_id and c.user_id=old.user_id loop
    perform public.club_refresh_customer_access_projection(r.organisation_id,r.id);
   end loop;
  end if;
 end if;
 return coalesce(new,old);
end; $$;
drop trigger if exists club_grant_access_projection_refresh on public.club_entitlement_grants;
create trigger club_grant_access_projection_refresh after insert or update or delete on public.club_entitlement_grants for each row execute function public.club_refresh_grant_access_projection();

-- One-time migration provisioning for existing people with gym-access products.
do $provision$ declare r record; begin
 for r in select distinct provision.organisation_id,provision.id from (
  select c.organisation_id,c.id from public.club_customers c join public.club_membership_holders h on h.organisation_id=c.organisation_id and (h.customer_id=c.id or h.user_id=c.user_id) join public.club_memberships m on m.id=h.membership_id join public.club_product_entitlements e on c.user_id is null and e.product_id=m.product_id and e.entitlement_key='gym_access'
  union all
  select c.organisation_id,c.id from public.club_customers c join public.club_entitlement_grants g on g.organisation_id=c.organisation_id and g.user_id=c.user_id and g.entitlement_key='gym_access'
 ) provision loop
  perform public.club_ensure_person_access_credentials(r.organisation_id,r.id); perform public.club_refresh_customer_access_projection(r.organisation_id,r.id);
 end loop;
end $provision$;

create or replace function public.club_get_my_access_pass(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; credentials jsonb; projection public.club_member_access_projection%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=auth.uid();
 if not found then raise exception 'Member identity is unavailable' using errcode='P0002'; end if;
 credentials:=public.club_ensure_person_access_credentials(p_organisation_id,c.id);
 select * into projection from public.club_member_access_projection where organisation_id=p_organisation_id and customer_id=c.id;
 if not found then projection:=public.club_refresh_customer_access_projection(p_organisation_id,c.id); end if;
 if projection.access_state='not_started' and projection.valid_from<=now() then projection:=public.club_refresh_customer_access_projection(p_organisation_id,c.id); end if;
 return credentials||jsonb_build_object('customerId',c.id,'displayName',c.display_name,'accessAllowed',coalesce(projection.access_allowed and (projection.valid_from is null or projection.valid_from<=now()) and (projection.valid_until is null or projection.valid_until>now()),false),'accessState',case when projection.valid_until is not null and projection.valid_until<=now() then 'expired' else projection.access_state end,'reason',case when projection.valid_until is not null and projection.valid_until<=now() then 'membership_expired' else projection.reason end,'validFrom',projection.valid_from,'validUntil',projection.valid_until,'graceState',projection.grace_state,'lastRecalculated',projection.recalculated_at);
end; $$;

create or replace function public.club_reissue_person_access_credential(p_organisation_id uuid,p_customer_id uuid,p_type text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_id uuid; result jsonb;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') or p_type not in ('pin','qr') or nullif(btrim(p_reason),'') is null then raise exception 'Credential reissue is not permitted' using errcode='42501'; end if;
 update public.club_access_credentials set status='revoked',revoked_at=now() where organisation_id=p_organisation_id and customer_id=p_customer_id and credential_type=p_type and permanent and status='active' returning id into old_id;
 result:=public.club_ensure_person_access_credentials(p_organisation_id,p_customer_id);
 update public.club_access_credentials set reissued_from=old_id where organisation_id=p_organisation_id and customer_id=p_customer_id and credential_type=p_type and permanent and status='active';
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,reason,metadata) values(p_organisation_id,auth.uid(),'access.credential_reissued','customer',p_customer_id,p_reason,jsonb_build_object('credential_type',p_type,'previous_credential_id',old_id));
 return case when p_type='pin' then jsonb_build_object('pin',result->>'pin') else jsonb_build_object('qrToken',result->>'qrToken') end;
end; $$;

create or replace function public.club_issue_customer_access_pass(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Access pass issue is not permitted' using errcode='42501'; end if;
 perform public.club_refresh_customer_access_projection(p_organisation_id,p_customer_id);
 return public.club_ensure_person_access_credentials(p_organisation_id,p_customer_id);
end; $$;

create or replace function public.club_set_location_access_mode(p_organisation_id uuid,p_location_id uuid,p_access_mode text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare l public.club_locations%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Location access configuration is not permitted' using errcode='42501'; end if;
 if p_access_mode not in ('CHECKIN_ONLY','DOOR_CONTROLLED','DISABLED') then raise exception 'Invalid location access mode' using errcode='22023'; end if;
 update public.club_locations set access_mode=p_access_mode where id=p_location_id and organisation_id=p_organisation_id returning * into l;
 if not found then raise exception 'Location not found' using errcode='P0002'; end if;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'access.location_mode_changed','location',p_location_id,jsonb_build_object('access_mode',p_access_mode));
 return jsonb_build_object('locationId',l.id,'accessMode',l.access_mode);
end; $$;

create or replace function public.club_access_decide_customer(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_credential_type text,p_source text,p_device_id uuid default null,p_nonce text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; p public.club_member_access_projection%rowtype; l public.club_locations%rowtype; allowed boolean:=false; why text:='credential_not_found'; audit_id uuid; bounced uuid; record_attendance boolean:=false; unlock_ok boolean:=false;
begin
 select * into l from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
 select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
 if l.id is null or not l.active or l.access_mode='DISABLED' then why:='location_disabled';
 elsif c.id is null then why:='credential_not_found';
 else
  select * into p from public.club_member_access_projection where organisation_id=p_organisation_id and customer_id=c.id;
  if not found then p:=public.club_refresh_customer_access_projection(p_organisation_id,c.id); end if;
  if p.access_state='not_started' and p.valid_from<=now() then p:=public.club_refresh_customer_access_projection(p_organisation_id,c.id); end if;
  if p.valid_from is not null and p.valid_from>now() then why:='membership_not_started';
  elsif p.valid_until is not null and p.valid_until<=now() then why:='membership_expired';
  elsif not p.access_allowed then why:=p.reason;
  elsif p.access_scope='locations' and coalesce(cardinality(p.location_ids),0)>0 and not p_location_id=any(p.location_ids) then why:='location_not_included';
  else allowed:=true; why:=p.reason; unlock_ok:=l.access_mode='DOOR_CONTROLLED';
   select id into bounced from public.club_access_decisions where organisation_id=p_organisation_id and location_id=p_location_id and customer_id=c.id and decision='allow' and attendance_recorded and decided_at>now()-interval '10 seconds' order by decided_at desc limit 1;
   record_attendance:=bounced is null;
  end if;
 end if;
 insert into public.club_access_decisions(organisation_id,location_id,customer_id,membership_id,device_id,actor_user_id,decision,reason,credential_type,source,request_nonce,access_state,attendance_recorded,bounce_of,location_mode,unlock_permitted)
 values(p_organisation_id,p_location_id,c.id,p.membership_id,p_device_id,auth.uid(),case when allowed then 'allow' else 'deny' end,why,p_credential_type,p_source,p_nonce,p.access_state,record_attendance,bounced,l.access_mode,allowed and unlock_ok) returning id into audit_id;
 return jsonb_build_object('allowed',allowed,'decision',case when allowed then 'allow' else 'deny' end,'reason',why,'accessState',p.access_state,'member',case when c.id is null then null else jsonb_build_object('customerId',c.id,'displayName',c.display_name) end,'membership',case when p.membership_id is null then null else jsonb_build_object('id',p.membership_id,'source',p.membership_source,'startsAt',p.valid_from,'endsAt',p.valid_until) end,'locationMode',l.access_mode,'attendanceRecorded',record_attendance,'unlockPermitted',allowed and unlock_ok,'decidedAt',now(),'auditReference',audit_id);
end; $$;

create or replace function public.club_reception_access_decision(p_organisation_id uuid,p_location_id uuid,p_credential text,p_credential_type text default 'pin')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then raise exception 'Access decisions require reception authority' using errcode='42501'; end if;
 if p_credential_type not in ('pin','qr','legacy_member_reference','barcode') then raise exception 'Invalid access credential' using errcode='22023'; end if;
 select customer_id into c from public.club_access_credentials where credential_hash=public.club_access_credential_hash(p_credential_type,p_credential) and credential_type=p_credential_type and status='active' and organisation_id=p_organisation_id and (valid_from is null or valid_from<=now()) and (valid_until is null or valid_until>now());
 return public.club_access_decide_customer(p_organisation_id,p_location_id,c,p_credential_type,'reception');
end; $$;

create or replace function public.club_device_access_decision(p_device_id uuid,p_secret text,p_nonce text,p_presented_at timestamptz,p_credential text,p_credential_type text default 'pin')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_access_devices%rowtype; c uuid; recent_failures integer; audit_id uuid;
begin
 select * into d from public.club_access_devices where id=p_device_id and status='active' and secret_hash=extensions.digest(p_secret,'sha256') for update;
 if not found then raise exception 'Device authentication failed' using errcode='42501'; end if;
 if p_presented_at is null or abs(extract(epoch from(now()-p_presented_at)))>120 or nullif(btrim(p_nonce),'') is null then raise exception 'Stale or invalid device request' using errcode='22023'; end if;
 if exists(select 1 from public.club_access_decisions where device_id=d.id and request_nonce=p_nonce) then raise exception 'Device request replayed' using errcode='23505'; end if;
 if (select count(*) from public.club_access_decisions where device_id=d.id and decided_at>now()-interval '1 minute')>=120 then raise exception 'Device rate limit exceeded' using errcode='54000'; end if;
 if p_credential_type='pin' then select count(*) into recent_failures from public.club_access_decisions where device_id=d.id and credential_type='pin' and decision='deny' and reason in ('credential_not_found','access_throttled') and decided_at>now()-interval '5 minutes'; end if;
 if coalesce(recent_failures,0)>=10 then insert into public.club_access_decisions(organisation_id,location_id,device_id,decision,reason,credential_type,source,request_nonce,location_mode) values(d.organisation_id,d.location_id,d.id,'deny','access_throttled',p_credential_type,'device',p_nonce,(select access_mode from public.club_locations where id=d.location_id)) returning id into audit_id; return jsonb_build_object('allowed',false,'decision','deny','reason','access_throttled','attendanceRecorded',false,'unlockPermitted',false,'auditReference',audit_id,'decidedAt',now()); end if;
 select customer_id into c from public.club_access_credentials where credential_hash=public.club_access_credential_hash(p_credential_type,p_credential) and credential_type=p_credential_type and status='active' and organisation_id=d.organisation_id and (valid_from is null or valid_from<=now()) and (valid_until is null or valid_until>now());
 update public.club_access_devices set last_seen_at=now() where id=d.id;
 return public.club_access_decide_customer(d.organisation_id,d.location_id,c,p_credential_type,'device',d.id,p_nonce);
end; $$;

revoke all on function public.club_access_credential_hash(text,text),public.club_ensure_person_access_credentials(uuid,uuid),public.club_refresh_customer_access_projection(uuid,uuid),public.club_refresh_membership_access_projection(),public.club_refresh_holder_access_projection(),public.club_refresh_billing_access_projection(),public.club_refresh_policy_access_projections(),public.club_refresh_product_access_projection(),public.club_refresh_grant_access_projection(),public.club_access_decide_customer(uuid,uuid,uuid,text,text,uuid,text),public.club_get_my_access_pass(uuid),public.club_reissue_person_access_credential(uuid,uuid,text,text),public.club_issue_customer_access_pass(uuid,uuid),public.club_set_location_access_mode(uuid,uuid,text),public.club_reception_access_decision(uuid,uuid,text,text),public.club_device_access_decision(uuid,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.club_get_my_access_pass(uuid) to authenticated;
grant execute on function public.club_reissue_person_access_credential(uuid,uuid,text,text),public.club_issue_customer_access_pass(uuid,uuid),public.club_set_location_access_mode(uuid,uuid,text),public.club_reception_access_decision(uuid,uuid,text,text) to authenticated;
grant execute on function public.club_device_access_decision(uuid,text,text,timestamptz,text,text) to service_role;
