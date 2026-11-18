-- Automatically connect an authenticated R12 identity to one unambiguous
-- ClubManager customer record after ownership of its email has been verified.
-- This delegates the actual link/holder transfer to the existing audited claim RPC.
begin;

create or replace function public.club_imported_member_email_is_ambiguous(
  p_organisation_id uuid,p_customer_id uuid,p_email text
) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows integer; v_household boolean;
begin
  select count(*) into v_rows from public.club_member_import_rows r
  where r.organisation_id=p_organisation_id
    and lower(btrim(r.normalized_values->>'email'))=lower(btrim(p_email));
  if v_rows>1 then return true; end if;
  select exists(
    select 1 from public.club_member_import_identities i
    join public.club_member_import_rows r on r.organisation_id=i.organisation_id
      and r.normalized_values->>'legacyReference'=i.source_member_reference
    join public.club_member_import_batches b on b.id=r.batch_id and b.organisation_id=r.organisation_id
    where i.organisation_id=p_organisation_id and i.customer_id=p_customer_id and i.source_system='clubmanager'
      and nullif(btrim(coalesce(r.raw_values->>(b.mapping->>'householdReference'),r.raw_values->>'shared_contract_id',r.raw_values->>'household_reference')),'') is not null
  ) into v_household;
  return coalesce(v_household,false);
end; $$;
revoke all on function public.club_imported_member_email_is_ambiguous(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.club_preview_existing_member_claim(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_email text; v_verified timestamptz; v_count integer; c public.club_customers%rowtype;
  v_local text; v_domain text;
begin
  if auth.uid() is null then return jsonb_build_object('state','email_verification_required'); end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=auth.uid();
  if found then return jsonb_build_object('state','already_linked','customer_id',c.id,
    'display_name',c.display_name,'email',c.email,
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.name,'status',m.status))
      from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id
      join public.club_products p on p.id=m.product_id
      where h.organisation_id=p_organisation_id and (h.customer_id=c.id or h.user_id=auth.uid())),'[]'::jsonb)); end if;
  select lower(btrim(email)),email_confirmed_at into v_email,v_verified from auth.users where id=auth.uid();
  if v_verified is null or v_email is null then return jsonb_build_object('state','email_verification_required'); end if;
  v_local:=split_part(v_email,'@',1); v_domain:=split_part(v_email,'@',2);
  select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count=0 then return jsonb_build_object('state','staff_help_required'); end if;
  if v_count>1 then return jsonb_build_object('state','ambiguous'); end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if c.user_id=auth.uid() then return jsonb_build_object('state','already_linked'); end if;
  if c.user_id is not null then return jsonb_build_object('state','staff_help_required'); end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or v_domain in ('example.com','example.net','example.org','invalid','localhost')
     or v_local in ('admin','family','info','membership','noreply','no-reply','shared','test','unknown','placeholder')
     or v_local like '%placeholder%'
     or public.club_imported_member_email_is_ambiguous(p_organisation_id,c.id,v_email) then
    return jsonb_build_object('state','ambiguous');
  end if;
  return jsonb_build_object('state','ready','customer_id',c.id,'display_name',c.display_name,'email',c.email,
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.name,'status',m.status))
      from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id
      join public.club_products p on p.id=m.product_id where h.customer_id=c.id),'[]'::jsonb));
end; $$;
revoke all on function public.club_preview_existing_member_claim(uuid) from public,anon;
grant execute on function public.club_preview_existing_member_claim(uuid) to authenticated;

create or replace function public.club_claim_existing_member(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_email text; v_verified timestamptz; v_count integer; c public.club_customers%rowtype;
  h record; e record; actor_role text; v_local text; v_domain text;
begin
  select lower(btrim(email)),email_confirmed_at into v_email,v_verified from auth.users where id=auth.uid();
  if auth.uid() is null or v_verified is null or v_email is null then raise exception 'Verified account required' using errcode='42501'; end if;
  v_local:=split_part(v_email,'@',1); v_domain:=split_part(v_email,'@',2);
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or v_domain in ('example.com','example.net','example.org','invalid','localhost')
     or v_local in ('admin','family','info','membership','noreply','no-reply','shared','test','unknown','placeholder')
     or v_local like '%placeholder%' then raise exception 'This email needs staff identity verification' using errcode='42501'; end if;
  select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count<>1 then raise exception 'Member record is missing or ambiguous' using errcode='42501'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id
    and user_id is null and lower(btrim(email))=v_email for update;
  if not found then raise exception 'Member record does not match this account' using errcode='42501'; end if;
  if exists(select 1 from public.club_member_import_identities where organisation_id=p_organisation_id
    and customer_id=c.id and source_system='clubmanager'
    and public.club_imported_member_email_is_ambiguous(p_organisation_id,c.id,v_email)) then
    raise exception 'Shared or ambiguous legacy identity requires staff verification' using errcode='42501';
  end if;
  if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and user_id=auth.uid() and id<>c.id) then
    raise exception 'Account is already linked to another member' using errcode='23505'; end if;
  insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,auth.uid(),'member',true)
    on conflict(organisation_id,user_id) do nothing;
  update public.club_customers set user_id=auth.uid(),updated_at=now() where id=c.id returning * into c;
  for h in select m.*,p.id product_id from public.club_membership_holders holder
    join public.club_memberships m on m.id=holder.membership_id and m.organisation_id=holder.organisation_id
    join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
    where holder.organisation_id=p_organisation_id and holder.customer_id=c.id loop
    if exists(select 1 from public.club_membership_holders where membership_id=h.id and user_id=auth.uid()) then
      delete from public.club_membership_holders where membership_id=h.id and customer_id=c.id;
    else update public.club_membership_holders set user_id=auth.uid(),customer_id=null
      where membership_id=h.id and customer_id=c.id; end if;
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,
      allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select auth.uid(),h.organisation_id,h.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),
      e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,
      h.starts_at,h.ends_at,h.source from public.club_product_entitlements e where e.product_id=h.product_id
      and e.organisation_id=p_organisation_id
      and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=h.id
        and g.user_id=auth.uid() and g.entitlement_key=e.entitlement_key);
  end loop;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.account_self_claimed','customer',c.id,jsonb_build_object('match','verified_email'));
  return jsonb_build_object('customer_id',c.id,'status','linked');
end; $$;
revoke all on function public.club_claim_existing_member(uuid,uuid) from public,anon;
grant execute on function public.club_claim_existing_member(uuid,uuid) to authenticated;

create or replace function public.club_auto_link_verified_imported_member()
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_email text;
  v_user uuid:=auth.uid();
  v_org public.club_organisations%rowtype;
  v_customer public.club_customers%rowtype;
  v_count integer;
  v_local text;
  v_domain text;
begin
  if v_user is null then return jsonb_build_object('state','sign_in_required'); end if;
  select lower(btrim(email)) into v_email from auth.users
    where id=v_user and email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('state','email_verification_required'); end if;

  select * into v_org from public.club_organisations
    where slug='madhouse-gym' and active;
  if not found then return jsonb_build_object('state','not_available'); end if;

  if exists(select 1 from public.club_customers
    where organisation_id=v_org.id and user_id=v_user) then
    return jsonb_build_object('state','already_linked');
  end if;

  v_local:=split_part(v_email,'@',1);
  v_domain:=split_part(v_email,'@',2);
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or v_domain in ('example.com','example.net','example.org','invalid','localhost')
     or v_local in ('admin','family','info','membership','noreply','no-reply','shared','test','unknown','placeholder')
     or v_local like '%placeholder%' then
    return jsonb_build_object('state','shared_or_placeholder');
  end if;

  select count(*) into v_count from public.club_customers c
  where c.organisation_id=v_org.id and lower(btrim(c.email))=v_email;
  if v_count=0 then return jsonb_build_object('state','no_match'); end if;
  if v_count<>1 then return jsonb_build_object('state','ambiguous'); end if;

  select c.* into v_customer from public.club_customers c
  where c.organisation_id=v_org.id and lower(btrim(c.email))=v_email
    and c.user_id is null
    and exists(select 1 from public.club_member_import_identities i
      where i.organisation_id=c.organisation_id and i.customer_id=c.id and i.source_system='clubmanager')
  for update;
  if not found then return jsonb_build_object('state','identity_review_required'); end if;

  if public.club_imported_member_email_is_ambiguous(v_org.id,v_customer.id,v_email) then
    return jsonb_build_object('state','shared_or_ambiguous_email');
  end if;

  -- This existing RPC rechecks exact verified email ownership, locks the row,
  -- rejects a second customer per account, transfers membership holders and
  -- writes the existing member.account_self_claimed audit event.
  perform public.club_claim_existing_member(v_org.id,v_customer.id);
  return jsonb_build_object('state','linked');
exception when unique_violation then
  if exists(select 1 from public.club_customers where organisation_id=v_org.id and user_id=v_user) then
    return jsonb_build_object('state','already_linked');
  end if;
  return jsonb_build_object('state','ambiguous');
end; $$;

revoke all on function public.club_auto_link_verified_imported_member() from public,anon;
grant execute on function public.club_auto_link_verified_imported_member() to authenticated;

-- Stop a verified member from opening a second overlapping gym-access purchase.
-- The membership being activated by this same request is excluded on its final
-- update; unrelated products such as PT/classes are unaffected.
create or replace function public.club_block_duplicate_active_gym_join()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status in ('cancelled','rejected') then return new; end if;
  if new.user_id is null then return new; end if;
  if not exists(select 1 from public.club_product_entitlements e
    where e.organisation_id=new.organisation_id and e.product_id=new.product_id and e.entitlement_key='gym_access') then
    return new;
  end if;
  if exists(
    select 1
    from public.club_membership_holders h
    join public.club_memberships m on m.id=h.membership_id and m.organisation_id=h.organisation_id
    join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id
    join public.club_product_entitlements e on e.product_id=p.id and e.organisation_id=p.organisation_id
      and e.entitlement_key='gym_access'
    where h.organisation_id=new.organisation_id
      and (h.user_id=new.user_id or (new.customer_id is not null and h.customer_id=new.customer_id))
      and m.id is distinct from new.membership_id
      and m.status in ('active','paused') and m.starts_at<=now()
      and (m.ends_at is null or m.ends_at>now())
  ) then
    raise exception 'An existing gym membership is already linked to this R12 account' using errcode='23505';
  end if;
  return new;
end; $$;
revoke all on function public.club_block_duplicate_active_gym_join() from public,anon,authenticated;
drop trigger if exists club_block_duplicate_active_gym_join on public.club_membership_join_requests;
create trigger club_block_duplicate_active_gym_join
before insert or update of organisation_id,user_id,customer_id,product_id,status,membership_id
on public.club_membership_join_requests
for each row execute function public.club_block_duplicate_active_gym_join();

commit;
