-- Align Club management and operational staff packages at the authoritative database boundary.
-- Coach permissions and gym memberships remain independent systems.

create or replace function public.club_capabilities_for_role(p_role text)
returns text[] language sql immutable set search_path=pg_catalog,public as $$
  select case
    when p_role in ('owner','gym_admin') then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile',
      'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage',
      'induction.manage_policy','induction.perform','classes.manage','services.manage',
      'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
      'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role in ('gym_staff','trainer') then array[
      'members.view','members.create','members.link_account','memberships.assign',
      'payments.take','payments.record_cash','refunds.issue','inventory.adjust','commerce.stock_remove',
      'induction.perform','classes.manage','services.manage','supplier.orders_manage','supplier.receive',
      'commerce.collections_manage','staff.work_submit'
    ]::text[]
    else '{}'::text[]
  end;
$$;
revoke all on function public.club_capabilities_for_role(text) from public,anon,authenticated;

alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in (
  'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
  'payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile',
  'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage',
  'induction.manage_policy','induction.perform','classes.manage','services.manage',
  'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
  'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
));

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null
    and p_user_id=auth.uid()
    and exists (
      select 1
      from public.club_members m
      where m.organisation_id=p_organisation_id
        and m.user_id=p_user_id
        and m.active
        and m.role in ('owner','gym_admin','gym_staff','trainer')
        and not exists (
          select 1 from public.club_staff_permission_overrides o
          where o.organisation_id=p_organisation_id and o.user_id=p_user_id
            and o.capability=p_capability and o.decision='deny'
        )
        and (
          p_capability=any(public.club_capabilities_for_role(m.role))
          or (
            p_capability<>'staff.permissions_manage'
            and exists (
              select 1 from public.club_staff_permission_overrides o
              where o.organisation_id=p_organisation_id and o.user_id=p_user_id
                and o.capability=p_capability and o.decision='allow'
            )
          )
        )
    );
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;

create or replace function public.club_save_staff_permission(p_organisation_id uuid,p_user_id uuid,p_capability text,p_decision text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff permission management is not permitted' using errcode='42501';
  end if;
  if p_decision not in ('allow','deny') or not (p_capability=any(public.club_capabilities_for_role('owner'))) then
    raise exception 'Invalid permission' using errcode='22023';
  end if;
  select role into target_role from public.club_members
    where organisation_id=p_organisation_id and user_id=p_user_id and active
      and role in ('owner','gym_admin','gym_staff','trainer');
  if target_role is null then raise exception 'Staff member not found' using errcode='P0002'; end if;
  if target_role='owner' and not public.club_has_active_role(p_organisation_id,array['owner']) then
    raise exception 'Only an owner may edit an owner' using errcode='42501';
  end if;
  if p_capability='staff.permissions_manage' and target_role not in ('owner','gym_admin') then
    raise exception 'Staff permission management is restricted to management roles' using errcode='42501';
  end if;
  if p_user_id=auth.uid() and p_capability='staff.permissions_manage' and p_decision='deny' then
    raise exception 'Managers cannot remove their own staff-management permission' using errcode='42501';
  end if;
  insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by)
  values(p_organisation_id,p_user_id,p_capability,p_decision,auth.uid())
  on conflict (organisation_id,user_id,capability)
  do update set decision=excluded.decision,created_by=excluded.created_by,created_at=now();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.permission_changed','club_member',p_user_id,
    jsonb_build_object('capability',p_capability,'decision',p_decision)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;
revoke all on function public.club_save_staff_permission(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_save_staff_permission(uuid,uuid,text,text) to authenticated;

create or replace function public.club_create_staff_access_grant(p_organisation_id uuid,p_email text,p_display_name text,p_role text,p_location_ids uuid[],p_capabilities text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; expected text[];
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff access requires staff-management permission' using errcode='42501';
  end if;
  if p_role not in ('gym_staff','gym_admin','trainer') or nullif(btrim(p_email),'') is null then
    raise exception 'Invalid staff access request' using errcode='22023';
  end if;
  expected:=public.club_capabilities_for_role(p_role);
  if (select coalesce(array_agg(distinct x order by x),'{}') from unnest(coalesce(p_capabilities,'{}')) x)
     is distinct from
     (select coalesce(array_agg(distinct x order by x),'{}') from unnest(expected) x) then
    raise exception 'The role permission package is invalid' using errcode='22023';
  end if;
  if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(
    select 1 from public.club_locations l where l.id=x and l.organisation_id=p_organisation_id and l.active
  )) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
  update public.club_staff_access_grants set status='expired'
    where organisation_id=p_organisation_id and email_normalized=lower(btrim(p_email))
      and status='pending' and expires_at<=now();
  insert into public.club_staff_access_grants(organisation_id,email_normalized,display_name,intended_role,location_ids,capabilities,created_by)
  values(p_organisation_id,lower(btrim(p_email)),nullif(btrim(p_display_name),''),p_role,coalesce(p_location_ids,'{}'),expected,auth.uid())
  returning * into g;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.access_grant_created','staff_access_grant',g.id,
    jsonb_build_object('role',p_role,'email',lower(btrim(p_email)))
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return to_jsonb(g);
end;
$$;
revoke all on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) from public,anon;
grant execute on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) to authenticated;

create or replace function public.club_claim_staff_access_grant(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; account_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email) into account_email from auth.users where id=auth.uid();
  select * into g from public.club_staff_access_grants
    where id=p_grant_id and status='pending' and expires_at>now()
      and email_normalized=lower(btrim(account_email)) for update;
  if not found then raise exception 'Staff access grant is unavailable' using errcode='42501'; end if;
  if g.capabilities is distinct from public.club_capabilities_for_role(g.intended_role) then raise exception 'Staff access grant has an invalid permission package' using errcode='42501'; end if;
  insert into public.club_members(organisation_id,user_id,role,active)
  values(g.organisation_id,auth.uid(),g.intended_role,true)
  on conflict (organisation_id,user_id) do update set role=excluded.role,active=true;
  delete from public.club_staff_location_access where organisation_id=g.organisation_id and user_id=auth.uid();
  insert into public.club_staff_location_access(organisation_id,user_id,location_id)
    select g.organisation_id,auth.uid(),x from unnest(g.location_ids) x on conflict do nothing;
  -- Role defaults are evaluated centrally; an invitation must not manufacture permanent overrides.
  delete from public.club_staff_permission_overrides where organisation_id=g.organisation_id and user_id=auth.uid();
  update public.club_staff_access_grants set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=g.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(g.organisation_id,auth.uid(),g.intended_role,'staff.access_grant_claimed','staff_access_grant',g.id,jsonb_build_object('role',g.intended_role));
  return jsonb_build_object('id',g.id,'organisation_id',g.organisation_id,'role',g.intended_role,'status','accepted');
end;
$$;
revoke all on function public.club_claim_staff_access_grant(uuid) from public,anon;
grant execute on function public.club_claim_staff_access_grant(uuid) to authenticated;

create or replace function public.club_revoke_staff_access_grant(p_organisation_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  update public.club_staff_access_grants set status='revoked',revoked_at=now()
    where id=p_grant_id and organisation_id=p_organisation_id and status='pending' returning * into g;
  if not found then raise exception 'Pending grant not found' using errcode='P0002'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id)
  select p_organisation_id,auth.uid(),m.role,'staff.access_grant_revoked','staff_access_grant',g.id
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return to_jsonb(g);
end;
$$;

create or replace function public.club_replace_staff_locations(p_organisation_id uuid,p_user_id uuid,p_location_ids uuid[])
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  select role into target_role from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active;
  if target_role not in ('gym_staff','gym_admin','trainer') then raise exception 'Operational staff member not found' using errcode='P0002'; end if;
  if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.id=x and l.active)) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
  delete from public.club_staff_location_access where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.club_staff_location_access(organisation_id,user_id,location_id)
    select p_organisation_id,p_user_id,x from unnest(coalesce(p_location_ids,'{}')) x;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.locations_changed','club_member',p_user_id,jsonb_build_object('location_ids',coalesce(p_location_ids,'{}'))
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;

create or replace function public.club_set_staff_active(p_organisation_id uuid,p_user_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_role text; owners integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  select role into target_role from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id;
  if target_role is null then raise exception 'Staff member not found' using errcode='P0002'; end if;
  if p_user_id=auth.uid() and not p_active then raise exception 'You cannot deactivate your own Club access' using errcode='42501'; end if;
  if target_role='owner' and not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Only an owner may edit an owner' using errcode='42501'; end if;
  if target_role='owner' and not p_active then
    select count(*) into owners from public.club_members where organisation_id=p_organisation_id and role='owner' and active;
    if owners<=1 then raise exception 'The organisation must retain an active owner' using errcode='42501'; end if;
  end if;
  update public.club_members set active=p_active where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.status_changed','club_member',p_user_id,jsonb_build_object('active',p_active)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;

create or replace function public.club_set_staff_role(p_organisation_id uuid,p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  if p_role not in ('gym_staff','trainer','gym_admin') then raise exception 'Invalid staff role' using errcode='22023'; end if;
  select role into current_role from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active;
  if current_role is null then raise exception 'Staff member not found' using errcode='P0002'; end if;
  if current_role='owner' then raise exception 'Owner role is protected' using errcode='42501'; end if;
  update public.club_members set role=p_role where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.role_changed','club_member',p_user_id,jsonb_build_object('from',current_role,'to',p_role)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;

revoke all on function public.club_revoke_staff_access_grant(uuid,uuid) from public,anon;
revoke all on function public.club_replace_staff_locations(uuid,uuid,uuid[]) from public,anon;
revoke all on function public.club_set_staff_active(uuid,uuid,boolean) from public,anon;
revoke all on function public.club_set_staff_role(uuid,uuid,text) from public,anon;
grant execute on function public.club_revoke_staff_access_grant(uuid,uuid) to authenticated;
grant execute on function public.club_replace_staff_locations(uuid,uuid,uuid[]) to authenticated;
grant execute on function public.club_set_staff_active(uuid,uuid,boolean) to authenticated;
grant execute on function public.club_set_staff_role(uuid,uuid,text) to authenticated;

create or replace function public.club_append_audit_event(p_organisation_id uuid,p_action text,p_target_type text default null,p_target_id uuid default null,p_location_id uuid default null,p_reason text default null,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text; row public.club_audit_events%rowtype;
begin
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active and role in ('owner','gym_admin','gym_staff','trainer');
  if auth.uid() is null or actor_role is null then raise exception 'Audit actor is not authorised' using errcode='42501'; end if;
  if nullif(btrim(p_action),'') is null or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid audit event' using errcode='22023'; end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id) then raise exception 'Audit location is outside organisation' using errcode='22023'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  values(p_organisation_id,auth.uid(),actor_role,btrim(p_action),p_target_type,p_target_id,p_location_id,nullif(btrim(p_reason),''),coalesce(p_metadata,'{}')-'actor_user_id'-'organisation_id'-'actor_role')
  returning * into row;
  return to_jsonb(row);
end;
$$;
revoke all on function public.club_append_audit_event(uuid,text,text,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.club_append_audit_event(uuid,text,text,uuid,uuid,text,jsonb) to authenticated;

create or replace function public.club_create_customer(p_organisation_id uuid,p_user_id uuid,p_display_name text,p_email text,p_phone text,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_customers%rowtype; v_staff boolean;
begin
  v_staff:=auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create');
  if auth.uid() is null or (not v_staff and p_user_id is distinct from auth.uid()) then raise exception 'Customer creation is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations where id=p_organisation_id and active) then raise exception 'Organisation is unavailable' using errcode='22023'; end if;
  if nullif(btrim(p_display_name),'') is null or p_status not in ('guest','member','customer') or (not v_staff and p_status<>'customer') then raise exception 'Invalid customer input' using errcode='22023'; end if;
  insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
  values(p_organisation_id,p_user_id,btrim(p_display_name),p_email,p_phone,p_status) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.club_assign_membership(p_organisation_id uuid,p_product_id uuid,p_customer_id uuid,p_holder_user_ids uuid[],p_starts_at timestamptz,p_ends_at timestamptz,p_source text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_product public.club_products%rowtype; v_customer public.club_customers%rowtype; v_membership public.club_memberships%rowtype; v_users uuid[]; v_existing public.club_memberships%rowtype; v_holders jsonb; v_grants jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Membership assignment is not permitted' using errcode='42501'; end if;
  select * into v_product from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
  if not found or v_product.archived_at is not null or v_product.kind<>'membership' then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at<=p_starts_at) or nullif(trim(p_idempotency_key),'') is null then raise exception 'Invalid membership assignment' using errcode='22023'; end if;
  if p_customer_id is null and coalesce(cardinality(p_holder_user_ids),0)=0 then raise exception 'At least one holder is required' using errcode='22023'; end if;
  if p_customer_id is not null then
    select * into v_customer from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
    if not found then raise exception 'Customer is not in this organisation' using errcode='42501'; end if;
  end if;
  select coalesce(array_agg(distinct x order by x),'{}') into v_users from unnest(coalesce(p_holder_user_ids,'{}')) x;
  if v_customer.user_id is not null then v_users:=array(select distinct x from unnest(v_users||v_customer.user_id) x order by x); end if;
  if exists(select 1 from unnest(v_users) x where not exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=x and m.active)) then raise exception 'Every holder must be an active organisation member' using errcode='22023'; end if;
  select * into v_existing from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.product_id<>p_product_id or v_existing.starts_at<>p_starts_at or v_existing.ends_at is distinct from p_ends_at or v_existing.source<>p_source
      or (p_customer_id is not null and v_customer.user_id is null and not exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.customer_id=p_customer_id))
      or (p_customer_id is null and exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.customer_id is not null))
      or exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null and not (h.user_id=any(v_users)))
      or (select count(*) from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null)<>cardinality(v_users)
    then raise exception 'Membership assignment idempotency conflict' using errcode='23505'; end if;
    select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_existing.id;
    select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_existing.id;
    return jsonb_build_object('membership',to_jsonb(v_existing),'holders',v_holders,'grants',v_grants);
  end if;
  insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
  values(p_organisation_id,p_product_id,'active',p_starts_at,p_ends_at,p_source,p_idempotency_key) returning * into v_membership;
  if p_customer_id is not null and v_customer.user_id is null then insert into public.club_membership_holders(id,membership_id,organisation_id,customer_id) values(gen_random_uuid(),v_membership.id,p_organisation_id,p_customer_id); end if;
  insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) select gen_random_uuid(),v_membership.id,p_organisation_id,x from unnest(v_users) x;
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
  select u,v_membership.organisation_id,v_membership.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,v_membership.starts_at,v_membership.ends_at,v_membership.source from unnest(v_users) u join public.club_product_entitlements e on e.product_id=v_product.id;
  select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_membership.id;
  select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_membership.id;
  return jsonb_build_object('membership',to_jsonb(v_membership),'holders',v_holders,'grants',v_grants);
end;
$$;

create or replace function public.club_link_customer_user(p_customer_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; h record; e public.club_product_entitlements%rowtype;
begin
  select * into c from public.club_customers where id=p_customer_id for update;
  if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(c.organisation_id,auth.uid(),'members.link_account') then raise exception 'Customer linking is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members m where m.organisation_id=c.organisation_id and m.user_id=p_user_id and m.active) then raise exception 'User is not an active organisation member' using errcode='42501'; end if;
  if c.user_id is not null and c.user_id<>p_user_id then raise exception 'Customer is already linked' using errcode='23505'; end if;
  update public.club_customers set user_id=p_user_id,updated_at=now() where id=c.id returning * into c;
  for h in select m.*,p.id product_id from public.club_membership_holders holder join public.club_memberships m on m.id=holder.membership_id join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id where holder.customer_id=c.id loop
    if exists(select 1 from public.club_membership_holders existing where existing.membership_id=h.id and existing.user_id=p_user_id) then delete from public.club_membership_holders where membership_id=h.id and customer_id=c.id; else update public.club_membership_holders set user_id=p_user_id,customer_id=null where membership_id=h.id and customer_id=c.id; end if;
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select p_user_id,h.organisation_id,h.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,h.starts_at,h.ends_at,h.source from public.club_product_entitlements e where e.product_id=h.product_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=h.id and g.user_id=p_user_id and g.entitlement_key=e.entitlement_key);
  end loop;
  return to_jsonb(c);
end;
$$;

create or replace function public.club_end_membership(p_organisation_id uuid,p_membership_id uuid,p_effective_at timestamptz,p_status text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; at timestamptz:=coalesce(p_effective_at,now());
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Membership ending is not permitted' using errcode='42501'; end if;
  if at<=now() and not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.end_immediately') then raise exception 'Immediate membership ending is not permitted' using errcode='42501'; end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Membership not found' using errcode='P0002'; end if;
  if p_status not in ('cancelled','expired') then raise exception 'Invalid membership end status' using errcode='22023'; end if;
  if m.ends_at is not null and m.ends_at<=at then return to_jsonb(m); end if;
  update public.club_memberships set ends_at=at,status=case when at<=now() then p_status else status end,ended_at=case when at<=now() then now() else ended_at end,ended_by=case when at<=now() then auth.uid() else ended_by end,end_requested_at=now(),end_requested_by=auth.uid(),end_reason=coalesce(p_reason,end_reason) where id=m.id returning * into m;
  return to_jsonb(m);
end;
$$;

revoke all on function public.club_create_customer(uuid,uuid,text,text,text,text) from public,anon;
revoke all on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) from public,anon;
revoke all on function public.club_link_customer_user(uuid,uuid) from public,anon;
revoke all on function public.club_end_membership(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.club_create_customer(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.club_link_customer_user(uuid,uuid) to authenticated;
grant execute on function public.club_end_membership(uuid,uuid,timestamptz,text,text) to authenticated;

create or replace function public.club_create_service_transaction(p_organisation_id uuid,p_location_id uuid,p_service_id uuid,p_customer_id uuid,p_quantity integer,p_unit_price_minor integer,p_currency text,p_payment_status text,p_payment_method text,p_payment_reference text,p_fulfilment_status text,p_external_fulfilment_reference text,p_occurred_at timestamptz,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_service_transactions%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage') then raise exception 'Service transaction creation is not permitted' using errcode='42501'; end if;
  if p_quantity<=0 or p_unit_price_minor<0 or p_currency!~'^[A-Z]{3}$' or p_payment_status not in ('unpaid','pending','paid','waived','refunded') or p_fulfilment_status not in ('pending','fulfilled','cancelled','failed') or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid service transaction input' using errcode='22023'; end if;
  if not exists(select 1 from public.club_services where id=p_service_id and organisation_id=p_organisation_id and (location_id is null or location_id=p_location_id)) then raise exception 'Service is unavailable at location' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Customer is not in transaction organisation' using errcode='22023'; end if;
  insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,external_fulfilment_reference,occurred_at,metadata)
  values(p_organisation_id,p_location_id,p_service_id,p_customer_id,auth.uid(),p_quantity,p_unit_price_minor,p_currency,p_payment_status,p_payment_method,p_payment_reference,p_fulfilment_status,p_external_fulfilment_reference,coalesce(p_occurred_at,now()),p_metadata) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.club_save_service(p_id uuid,p_organisation_id uuid,p_location_id uuid,p_name text,p_description text,p_category text,p_duration_minutes integer,p_price_minor integer,p_currency text,p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_services%rowtype;
begin
  if auth.uid() is null
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage')
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')
  then raise exception 'Service administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_category),'') is null or (p_duration_minutes is not null and p_duration_minutes<=0) or (p_price_minor is not null and p_price_minor<0) or p_currency!~'^[A-Z]{3}$' or p_active is null then raise exception 'Invalid service input' using errcode='22023'; end if;
  if p_id is null then
    insert into public.club_services(organisation_id,location_id,name,description,category,duration_minutes,price_minor,currency,active)
    values(p_organisation_id,p_location_id,btrim(p_name),p_description,btrim(p_category),p_duration_minutes,p_price_minor,p_currency,p_active) returning * into v_row;
  else
    update public.club_services set location_id=p_location_id,name=btrim(p_name),description=p_description,category=btrim(p_category),duration_minutes=p_duration_minutes,price_minor=p_price_minor,currency=p_currency,active=p_active,updated_at=now()
    where id=p_id and organisation_id=p_organisation_id returning * into v_row;
    if not found then raise exception 'Service not found' using errcode='P0002'; end if;
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.club_update_service_transaction(p_transaction_id uuid,p_payment_status text,p_payment_method text,p_payment_reference text,p_fulfilment_status text,p_external_fulfilment_reference text,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_service_transactions%rowtype;
begin
  select * into v_row from public.club_service_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Service transaction not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(v_row.organisation_id,auth.uid(),'services.manage') then raise exception 'Service transaction update is not permitted' using errcode='42501'; end if;
  if p_payment_status not in ('unpaid','pending','paid','waived','refunded') or p_fulfilment_status not in ('pending','fulfilled','cancelled','failed') or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid service transaction update' using errcode='22023'; end if;
  update public.club_service_transactions set payment_status=p_payment_status,payment_method=p_payment_method,payment_reference=p_payment_reference,fulfilment_status=p_fulfilment_status,external_fulfilment_reference=p_external_fulfilment_reference,metadata=p_metadata,updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.club_create_service_transaction(uuid,uuid,uuid,uuid,integer,integer,text,text,text,text,text,text,timestamptz,jsonb) from public,anon;
revoke all on function public.club_update_service_transaction(uuid,text,text,text,text,text,jsonb) from public,anon;
revoke all on function public.club_save_service(uuid,uuid,uuid,text,text,text,integer,integer,text,boolean) from public,anon;
grant execute on function public.club_create_service_transaction(uuid,uuid,uuid,uuid,integer,integer,text,text,text,text,text,text,timestamptz,jsonb) to authenticated;
grant execute on function public.club_update_service_transaction(uuid,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.club_save_service(uuid,uuid,uuid,text,text,text,integer,integer,text,boolean) to authenticated;

-- Existing Coach permission RPCs remain the sole source of Coach access.
-- Existing club membership records remain independent from both staff and Coach access.
