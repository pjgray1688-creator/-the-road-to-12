-- Complete verified staff invitation claims, owner activation of existing
-- accounts, and membership-independent Madhouse staff gym access.
-- This forward migration must be executed after its schema dependencies:
-- 2026-11-16/17 staff capability and onboarding migrations,
-- 2026-12-04/13/30 access projection migrations,
-- 2027-01-05/10 rota and prepared-identity migrations, and
-- 2027-01-27 capability updates. The November filename does not override
-- that required release order; do not replay it before those dependencies.

begin;

create or replace function public.club_provision_staff_access_grant_internal(
  p_grant_id uuid,p_user_id uuid,p_actor_user_id uuid,p_actor_role text,p_activation_source text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare
  g public.club_staff_access_grants%rowtype;
  account_email text;
  email_confirmed_at timestamptz;
  account_metadata jsonb;
  profile_name text;
begin
  select * into g from public.club_staff_access_grants where id=p_grant_id for update;
  if not found then raise exception 'Staff access grant is unavailable' using errcode='42501'; end if;
  if g.status='accepted' and g.accepted_by=p_user_id then
    return jsonb_build_object('id',g.id,'organisation_id',g.organisation_id,'role',g.intended_role,'coach_active',g.coach_requested,'status','accepted','already_provisioned',true);
  end if;
  if g.status<>'pending' or g.expires_at<=now() then
    raise exception 'Staff access grant is no longer pending or has expired' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_organisations o where o.id=g.organisation_id and o.active) then
    raise exception 'The invitation organisation is inactive' using errcode='42501';
  end if;
  select lower(u.email),u.email_confirmed_at,coalesce(u.raw_user_meta_data,'{}'::jsonb)
    into account_email,email_confirmed_at,account_metadata
    from auth.users u where u.id=p_user_id;
  if not found or email_confirmed_at is null or account_email is distinct from g.email_normalized then
    raise exception 'A verified account matching the invited email is required' using errcode='42501';
  end if;
  if g.intended_role not in ('gym_staff','gym_admin','trainer')
    or g.capabilities is distinct from public.club_capabilities_for_role(g.intended_role)
    or (g.coach_requested and g.intended_role not in ('gym_admin','trainer')) then
    raise exception 'Staff access grant has an invalid role or permission package' using errcode='42501';
  end if;
  if exists(select 1 from unnest(coalesce(g.location_ids,'{}'::uuid[])) location_id
    where not exists(select 1 from public.club_locations l where l.id=location_id and l.organisation_id=g.organisation_id and l.active)) then
    raise exception 'A staff location is no longer active in this organisation' using errcode='42501';
  end if;
  if exists(select 1 from public.club_members m where m.organisation_id=g.organisation_id and m.user_id=p_user_id
    and m.active and m.role in ('owner','gym_admin','gym_staff','trainer')) then
    raise exception 'This account already has active staff access' using errcode='23505';
  end if;

  profile_name:=coalesce(nullif(btrim(g.display_name),''),nullif(btrim(account_metadata->>'display_name'),''),
    nullif(btrim(concat_ws(' ',account_metadata->>'first_name',account_metadata->>'last_name')),''),split_part(account_email,'@',1));
  insert into public.profiles(id,email,display_name,first_name,last_name)
  values(p_user_id,account_email,profile_name,nullif(btrim(account_metadata->>'first_name'),''),nullif(btrim(account_metadata->>'last_name'),''))
  on conflict(id) do update set email=excluded.email,
    display_name=coalesce(nullif(btrim(public.profiles.display_name),''),excluded.display_name),
    first_name=coalesce(nullif(btrim(public.profiles.first_name),''),excluded.first_name),
    last_name=coalesce(nullif(btrim(public.profiles.last_name),''),excluded.last_name);

  insert into public.club_members(organisation_id,user_id,role,active)
  values(g.organisation_id,p_user_id,g.intended_role,true)
  on conflict(organisation_id,user_id) do update set role=excluded.role,active=true;
  delete from public.club_staff_location_access where organisation_id=g.organisation_id and user_id=p_user_id;
  insert into public.club_staff_location_access(organisation_id,user_id,location_id)
    select g.organisation_id,p_user_id,location_id from unnest(g.location_ids) location_id on conflict do nothing;
  delete from public.club_staff_permission_overrides where organisation_id=g.organisation_id and user_id=p_user_id;
  insert into public.coach_permissions(organisation_id,user_id,granted_by,active)
  values(g.organisation_id,p_user_id,g.created_by,g.coach_requested)
  on conflict(organisation_id,user_id) do update set active=excluded.active,granted_by=excluded.granted_by;

  update public.club_staff_access_grants set status='accepted',accepted_by=p_user_id,accepted_at=now() where id=g.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(g.organisation_id,p_actor_user_id,p_actor_role,
    case when p_activation_source='manager_activation' then 'staff.access_grant_activated_existing_account' else 'staff.access_grant_claimed' end,
    'staff_access_grant',g.id,jsonb_build_object('role',g.intended_role,'coach_requested',g.coach_requested,
      'target_user_id',p_user_id,'prepared_by',g.created_by,'activation_source',p_activation_source));
  if g.coach_requested then
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(g.organisation_id,p_actor_user_id,p_actor_role,'coach.access_changed','club_member',p_user_id,
      jsonb_build_object('active',true,'source','staff_access_grant','grant_id',g.id,'target_user_id',p_user_id));
  end if;
  return jsonb_build_object('id',g.id,'organisation_id',g.organisation_id,'role',g.intended_role,
    'coach_active',g.coach_requested,'member_intent',g.member_intent,'status','accepted','already_provisioned',false);
end;
$$;
revoke all on function public.club_provision_staff_access_grant_internal(uuid,uuid,uuid,text,text) from public,anon,authenticated;

create or replace function public.club_claim_staff_access_grant(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare account_email text; confirmed_at timestamptz; intended_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email),email_confirmed_at into account_email,confirmed_at from auth.users where id=auth.uid();
  if account_email is null or confirmed_at is null then raise exception 'Verify the invited email before claiming staff access' using errcode='42501'; end if;
  select g.intended_role into intended_role from public.club_staff_access_grants g
    where g.id=p_grant_id and lower(btrim(account_email))=g.email_normalized;
  if intended_role is null then raise exception 'Staff access grant is unavailable for this account' using errcode='42501'; end if;
  return public.club_provision_staff_access_grant_internal(p_grant_id,auth.uid(),auth.uid(),intended_role,'self_claim');
end;
$$;
revoke all on function public.club_claim_staff_access_grant(uuid) from public,anon;
grant execute on function public.club_claim_staff_access_grant(uuid) to authenticated;

create or replace function public.club_list_pending_staff_invites_for_management(p_organisation_id uuid)
returns table(id uuid,email_normalized text,display_name text,intended_role text,status text,location_ids uuid[],
  coach_requested boolean,member_intent boolean,created_at timestamptz,expires_at timestamptz,existing_account_verified boolean)
language sql stable security definer set search_path=pg_catalog,public,auth as $$
  select g.id,g.email_normalized,g.display_name,g.intended_role,g.status,g.location_ids,g.coach_requested,
    g.member_intent,g.created_at,g.expires_at,
    (g.expires_at>now() and exists(select 1 from auth.users u where lower(u.email)=g.email_normalized and u.email_confirmed_at is not null))
  from public.club_staff_access_grants g
  where g.organisation_id=p_organisation_id and g.status='pending'
    and auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage')
  order by g.created_at desc
$$;
revoke all on function public.club_list_pending_staff_invites_for_management(uuid) from public,anon;
grant execute on function public.club_list_pending_staff_invites_for_management(uuid) to authenticated;

create or replace function public.club_activate_existing_staff_access_grant(p_organisation_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare target_user_id uuid; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff activation requires staff-management permission' using errcode='42501';
  end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  select u.id into target_user_id from public.club_staff_access_grants g join auth.users u
    on lower(u.email)=g.email_normalized and u.email_confirmed_at is not null
    where g.id=p_grant_id and g.organisation_id=p_organisation_id and g.status='pending' and g.expires_at>now();
  if target_user_id is null then raise exception 'No existing verified account matches this active invitation' using errcode='42501'; end if;
  return public.club_provision_staff_access_grant_internal(p_grant_id,target_user_id,auth.uid(),actor_role,'manager_activation');
end;
$$;
revoke all on function public.club_activate_existing_staff_access_grant(uuid,uuid) from public,anon;
grant execute on function public.club_activate_existing_staff_access_grant(uuid,uuid) to authenticated;

-- Keep the existing membership/lifetime projection as the first choice. A
-- staff-only projection is used only when no stronger valid paid/lifetime
-- entitlement applies, and is limited to the two active Madhouse gym venues.
create or replace function public.club_refresh_customer_access_projection(p_organisation_id uuid,p_customer_id uuid)
returns public.club_member_access_projection language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  c public.club_customers%rowtype; selected record; suspended boolean:=false; grace text;
  state text:='no_access'; why text:='no_membership'; allowed boolean:=false;
  result public.club_member_access_projection%rowtype;
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
    union all
    select null::uuid,'active'::text,now(),null::timestamptz,'active_staff'::text,'locations'::text,
      array(select l.id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(l.name) in ('rotherham','carlton') order by lower(l.name))
    from public.club_members staff
    where c.user_id is not null and p_organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
      and staff.organisation_id=p_organisation_id and staff.user_id=c.user_id and staff.active
      and staff.role in ('owner','gym_admin','gym_staff','trainer')
      and exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(l.name) in ('rotherham','carlton'))
  ) candidate
  order by (
      candidate.status='active' and candidate.starts_at<=now() and (candidate.ends_at is null or candidate.ends_at>now())
      and (candidate.id is null or not exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=p_organisation_id and s.membership_id=candidate.id and s.active))
    ) desc,
    case when candidate.source='active_staff' then 1 else 0 end asc,
    (candidate.status='active' and candidate.starts_at<=now() and (candidate.ends_at is null or candidate.ends_at>now())) desc,
    (candidate.status='active') desc,candidate.starts_at desc,candidate.id nulls last limit 1;
  if found then
    select exists(select 1 from public.club_membership_payment_access_suspensions s join public.club_membership_billing_policies bp on bp.organisation_id=s.organisation_id and bp.access_suspension_enabled where s.organisation_id=p_organisation_id and s.membership_id=selected.id and s.active) into suspended;
    select o.state into grace from public.club_membership_billing_obligations o where o.organisation_id=p_organisation_id and o.membership_id=selected.id order by o.next_due_at desc limit 1;
    if selected.source='active_staff' then state:='active'; why:='active_staff'; allowed:=true;
    elsif selected.status='cancelled' then state:='cancelled'; why:='membership_cancelled';
    elsif selected.status<>'active' then state:=case when selected.status='expired' then 'expired' else 'inactive' end; why:=case when selected.status='expired' then 'membership_expired' else 'membership_inactive' end;
    elsif selected.starts_at>now() then state:='not_started'; why:='membership_not_started';
    elsif selected.ends_at is not null and selected.ends_at<=now() then state:='expired'; why:='membership_expired';
    elsif suspended then state:='action_required'; why:='payment_action_required';
    else allowed:=true; state:=case when grace in ('failed','grace','retry_scheduled','payment_pending','due') then 'grace' else 'active' end; why:=case when state='grace' then 'billing_grace' else 'active_entitlement' end; end if;
  end if;
  insert into public.club_member_access_projection(organisation_id,customer_id,membership_id,access_allowed,access_state,reason,valid_from,valid_until,grace_state,access_scope,location_ids,membership_source,recalculated_at)
  values(p_organisation_id,p_customer_id,selected.id,allowed,state,why,selected.starts_at,selected.ends_at,grace,selected.scope,coalesce(selected.location_ids,'{}'),selected.source,now())
  on conflict(organisation_id,customer_id) do update set membership_id=excluded.membership_id,access_allowed=excluded.access_allowed,access_state=excluded.access_state,reason=excluded.reason,valid_from=excluded.valid_from,valid_until=excluded.valid_until,grace_state=excluded.grace_state,access_scope=excluded.access_scope,location_ids=excluded.location_ids,membership_source=excluded.membership_source,recalculated_at=excluded.recalculated_at
  returning * into result;
  return result;
end;
$$;
revoke all on function public.club_refresh_customer_access_projection(uuid,uuid) from public,anon,authenticated;

create or replace function public.club_refresh_staff_customer_access_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c record;
begin
  if tg_op in ('UPDATE','DELETE') then
    for c in select id from public.club_customers where organisation_id=old.organisation_id and user_id=old.user_id loop
      perform public.club_refresh_customer_access_projection(old.organisation_id,c.id);
    end loop;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    for c in select id from public.club_customers where organisation_id=new.organisation_id and user_id=new.user_id loop
      perform public.club_refresh_customer_access_projection(new.organisation_id,c.id);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists club_staff_member_access_projection_refresh on public.club_members;
create trigger club_staff_member_access_projection_refresh
  after insert or update or delete on public.club_members
  for each row execute function public.club_refresh_staff_customer_access_projection();
revoke all on function public.club_refresh_staff_customer_access_projection() from public,anon,authenticated;

-- Recalculate derived access only; membership records and entitlements are untouched.
do $$ declare r record; begin
  for r in select c.organisation_id,c.id from public.club_customers c join public.club_members m on m.organisation_id=c.organisation_id and m.user_id=c.user_id
    where c.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid and m.active and m.role in ('owner','gym_admin','gym_staff','trainer')
  loop perform public.club_refresh_customer_access_projection(r.organisation_id,r.id); end loop;
end $$;

-- Reconcile current Madhouse work-location assignments without touching the
-- separate gym-entry projection or any historical rota rows.
do $$
declare
  org constant uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  rotherham uuid;
  carlton uuid;
  location_matches integer;
begin
  select count(*), (array_agg(id order by id))[1] into location_matches,rotherham from public.club_locations
    where organisation_id=org and active and lower(btrim(name))='rotherham';
  if location_matches<>1 then raise exception 'Expected exactly one active Madhouse Rotherham location'; end if;
  select count(*), (array_agg(id order by id))[1] into location_matches,carlton from public.club_locations
    where organisation_id=org and active and lower(btrim(name))='carlton';
  if location_matches<>1 then
    raise exception 'Expected exactly one active Madhouse Carlton location';
  end if;

  if exists(select 1 from public.club_madhouse_staff_assignments a where a.organisation_id=org and a.normalized_name='amie')
    and exists(select 1 from public.club_madhouse_staff_assignments a where a.organisation_id=org and a.normalized_name='aimee') then
    raise exception 'Both Amie and Aimee prepared identities exist; reconcile them before applying this migration';
  end if;
  update public.club_madhouse_staff_assignments set canonical_name='Aimee',normalized_name='aimee',location_ids=array[rotherham,carlton]::uuid[]
    where organisation_id=org and normalized_name='amie';
  update public.club_madhouse_staff_assignments set location_ids=array[rotherham,carlton]::uuid[]
    where organisation_id=org and normalized_name in ('luke','keenan');
  update public.club_madhouse_staff_assignments set location_ids=array[carlton]::uuid[]
    where organisation_id=org and normalized_name in ('steve','cody');

  update public.club_madhouse_rota_templates set staff_name='Aimee'
    where organisation_id=org and lower(regexp_replace(staff_name,'[^a-z]','','g'))='amie';
  update public.club_madhouse_class_templates set instructor_name='Aimee'
    where organisation_id=org and lower(regexp_replace(instructor_name,'[^a-z]','','g'))='amie';

  update public.club_madhouse_staff_assignments set active=false
    where organisation_id=org and normalized_name='shannon';
  update public.club_madhouse_rota_templates set active=false
    where organisation_id=org and lower(regexp_replace(staff_name,'[^a-z]','','g'))='shannon';
  update public.club_staff_rota_shifts r set status='cancelled',updated_at=now()
    where r.organisation_id=org and r.status='scheduled'
      and r.work_date >= (now() at time zone 'Europe/London')::date
      and (
        exists(select 1 from public.club_madhouse_staff_assignments a where a.id=r.staff_assignment_id and a.organisation_id=org and a.normalized_name='shannon')
        or exists(select 1 from public.profiles p where p.id=r.staff_user_id
          and lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g'))='shannon')
      );
end $$;

commit;
