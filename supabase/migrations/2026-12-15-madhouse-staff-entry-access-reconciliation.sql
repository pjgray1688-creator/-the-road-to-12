-- Keep Madhouse staff entry, member summaries, and operational access checks
-- consistent. Apply only after the staff and PIN/QR access migrations.
-- This is additive; it never creates or changes a paid membership.
begin;

create or replace function public.club_sync_madhouse_staff_access_identity(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare
  org constant uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  staff public.club_members%rowtype;
  customer public.club_customers%rowtype;
  person_name text;
  person_email text;
  created_customer_id uuid;
begin
  select * into staff from public.club_members
  where organisation_id=org and user_id=p_user_id and active
    and role in ('owner','gym_admin','gym_staff','trainer');

  if found then
    select nullif(btrim(p.display_name),''),nullif(lower(btrim(coalesce(p.email,u.email))), '')
      into person_name,person_email
      from auth.users u left join public.profiles p on p.id=u.id where u.id=p_user_id;
    select * into customer from public.club_customers
      where organisation_id=org and user_id=p_user_id for update;
    if not found then
      insert into public.club_customers(organisation_id,user_id,display_name,email,status)
      values(org,p_user_id,coalesce(person_name,split_part(coalesce(person_email,'Madhouse staff'),'@',1)),person_email,'customer')
      on conflict do nothing returning id into created_customer_id;
      select * into customer from public.club_customers where organisation_id=org and user_id=p_user_id for update;
      if created_customer_id is not null then
        insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
        values(org,p_user_id,staff.role,'staff.access_identity_created','customer',created_customer_id,
          jsonb_build_object('source','active_madhouse_staff_entry','membership_created',false));
      end if;
    end if;
    if customer.id is null then raise exception 'Could not establish Madhouse staff access identity' using errcode='23505'; end if;
    perform public.club_ensure_person_access_credentials(org,customer.id);
    perform public.club_refresh_customer_access_projection(org,customer.id);
  else
    for customer in select * from public.club_customers where organisation_id=org and user_id=p_user_id loop
      perform public.club_refresh_customer_access_projection(org,customer.id);
    end loop;
  end if;
end;
$$;
revoke all on function public.club_sync_madhouse_staff_access_identity(uuid) from public,anon,authenticated;

create or replace function public.club_refresh_staff_customer_access_projection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid then
    perform public.club_sync_madhouse_staff_access_identity(old.user_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid then
    perform public.club_sync_madhouse_staff_access_identity(new.user_id);
  end if;
  return null;
end;
$$;
revoke all on function public.club_refresh_staff_customer_access_projection() from public,anon,authenticated;

create or replace function public.club_refresh_customer_access_projection(p_organisation_id uuid,p_customer_id uuid)
returns public.club_member_access_projection language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  c public.club_customers%rowtype; selected record; suspended boolean:=false; grace text;
  state text:='no_access'; why text:='no_membership'; allowed boolean:=false;
  result public.club_member_access_projection%rowtype; staff_locations uuid[]; is_active_staff boolean:=false;
begin
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id;
  if not found then delete from public.club_member_access_projection where organisation_id=p_organisation_id and customer_id=p_customer_id; return null; end if;
  select candidate.* into selected from (
    select m.id,m.status,m.starts_at,m.ends_at,m.source,e.scope,e.location_ids
    from public.club_memberships m
    join public.club_membership_holders h on h.membership_id=m.id and h.organisation_id=m.organisation_id
    join lateral (
      select g.scope,g.location_ids from public.club_entitlement_grants g where c.user_id is not null and g.organisation_id=m.organisation_id and g.membership_id=m.id and g.user_id=c.user_id and g.entitlement_key='gym_access'
      union all select pe.scope,pe.location_ids from public.club_product_entitlements pe where c.user_id is null and pe.product_id=m.product_id and pe.entitlement_key='gym_access'
    ) e on true
    where m.organisation_id=p_organisation_id and (h.customer_id=c.id or (c.user_id is not null and h.user_id=c.user_id))
    union all
    select null::uuid,'active'::text,g.starts_at,g.ends_at,g.source,g.scope,g.location_ids
    from public.club_entitlement_grants g where c.user_id is not null and g.organisation_id=p_organisation_id and g.user_id=c.user_id and g.membership_id is null and g.entitlement_key='gym_access'
    union all
    select null::uuid,'active'::text,now(),null::timestamptz,'active_staff'::text,'locations'::text,
      array(select l.id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name)) in ('rotherham','carlton') order by lower(l.name))
    from public.club_members staff where c.user_id is not null and p_organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
      and staff.organisation_id=p_organisation_id and staff.user_id=c.user_id and staff.active and staff.role in ('owner','gym_admin','gym_staff','trainer')
      and (select count(*) from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name)) in ('rotherham','carlton'))=2
  ) candidate
  order by (candidate.status='active' and candidate.starts_at<=now() and (candidate.ends_at is null or candidate.ends_at>now())
    and (candidate.id is null or not exists(select 1 from public.club_membership_payment_access_suspensions s where s.organisation_id=p_organisation_id and s.membership_id=candidate.id and s.active))) desc,
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
  if p_organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid and c.user_id is not null then
    select array_agg(l.id order by lower(l.name)) into staff_locations from public.club_locations l
      where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name)) in ('rotherham','carlton');
    is_active_staff:=coalesce(cardinality(staff_locations),0)=2 and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=c.user_id and m.active and m.role in ('owner','gym_admin','gym_staff','trainer'));
    if is_active_staff then
      allowed:=true; state:='active'; why:='active_staff';
      selected.scope:='locations'; selected.location_ids:=staff_locations;
      selected.starts_at:=null; selected.ends_at:=null;
    end if;
  end if;
  insert into public.club_member_access_projection(organisation_id,customer_id,membership_id,access_allowed,access_state,reason,valid_from,valid_until,grace_state,access_scope,location_ids,membership_source,recalculated_at)
  values(p_organisation_id,p_customer_id,selected.id,allowed,state,why,selected.starts_at,selected.ends_at,grace,selected.scope,coalesce(selected.location_ids,'{}'),selected.source,now())
  on conflict(organisation_id,customer_id) do update set membership_id=excluded.membership_id,access_allowed=excluded.access_allowed,access_state=excluded.access_state,reason=excluded.reason,valid_from=excluded.valid_from,valid_until=excluded.valid_until,grace_state=excluded.grace_state,access_scope=excluded.access_scope,location_ids=excluded.location_ids,membership_source=excluded.membership_source,recalculated_at=excluded.recalculated_at
  returning * into result;
  return result;
end;
$$;
revoke all on function public.club_refresh_customer_access_projection(uuid,uuid) from public,anon,authenticated;

-- Access summaries are derived from the same verified active staff rule as the
-- door projection. Paid membership fields remain independent and unchanged.
create or replace function public.club_evaluate_member_access(p_organisation_id uuid,p_user_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_has_membership boolean; v_has_future_membership boolean; v_has_expired boolean;
  v_policy_future boolean:=false; v_has_valid boolean:=false; v_org_wide boolean:=false;
  v_locations uuid[]:='{}'; v_grant record; v_policy text; v_active_location boolean;
  staff_locations uuid[];
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then
    raise exception 'Location eligibility is not permitted' using errcode='42501';
  end if;
  select exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id),
    exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.starts_at>p_at),
    exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.ends_at is not null and m.ends_at<=p_at)
  into v_has_membership,v_has_future_membership,v_has_expired;

  for v_grant in select g.* from public.club_entitlement_grants g
    where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access'
      and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)
      and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)))
    order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id
  loop
    v_has_valid:=true;
    if v_grant.scope='future_locations' then v_policy_future:=true;
    elsif v_grant.scope='organisation' and coalesce(array_length(v_grant.location_ids,1),0)=0 then v_org_wide:=true;
    else v_locations:=v_locations||coalesce(v_grant.location_ids,'{}'); end if;
  end loop;
  select exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active and (v_policy_future or v_org_wide or l.id=any(v_locations))) into v_active_location;
  v_policy:=case when v_policy_future then 'future_locations' when v_org_wide then 'organisation' when coalesce(array_length(v_locations,1),0)>0 then 'locations' else null end;

  -- Existing valid membership/grant access remains authoritative. Staff access
  -- is a Madhouse-only fallback and explicitly names both active venues.
  if not (v_has_valid and v_active_location) and p_organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
    and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active and m.role in ('owner','gym_admin','gym_staff','trainer')) then
    select array_agg(l.id order by lower(l.name)) into staff_locations from public.club_locations l
      where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name)) in ('rotherham','carlton');
    if coalesce(cardinality(staff_locations),0)=2 then
      return jsonb_build_object('state','active','reason','active_staff','policy','locations',
        'permitted_location_ids',to_jsonb(staff_locations),'has_valid_grant',true);
    end if;
  end if;

  return jsonb_build_object(
    'state',case when v_has_valid and v_active_location then 'active' when v_has_membership and exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active') then 'needs_attention' else 'unavailable' end,
    'reason',case when not v_has_membership and not v_has_valid then 'no_membership' when v_has_future_membership and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_not_started' when v_has_expired and not v_has_valid then 'membership_expired' when v_has_membership and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_inactive' when not v_has_valid then 'gym_access_missing' else null end,
    'policy',v_policy,'permitted_location_ids',case when v_policy_future or v_org_wide then null else to_jsonb(v_locations) end,'has_valid_grant',v_has_valid);
end;
$$;

-- Keep location-specific profile checks consistent with the membership
-- evaluator while preserving the normal membership/grant path above.
create or replace function public.club_check_member_location_access_base(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location public.club_locations%rowtype; v_grant public.club_entitlement_grants%rowtype; v_access jsonb;
begin
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  if not found or not v_location.active then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_inactive'); end if;
  select g.* into v_grant from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) and (g.scope='future_locations' or (g.scope='organisation' and (coalesce(array_length(g.location_ids,1),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids))) order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id limit 1;
  if found then return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'membership_id',v_grant.membership_id,'source',v_grant.source,'valid_from',v_grant.starts_at,'valid_until',v_grant.ends_at,'access_policy',v_grant.scope); end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at);
  if v_access->>'reason'='active_staff' and p_location_id=any(array(select l.id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name)) in ('rotherham','carlton'))) then
    return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'source','active_staff','access_policy','locations');
  end if;
  if coalesce((v_access->>'has_valid_grant')::boolean,false) then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_not_included'); end if;
  return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason',coalesce(v_access->>'reason','gym_access_missing'));
end;
$$;

-- Provision only derived customer identity, door credentials, and access
-- projection for current active Madhouse staff; never a membership.
do $$ declare staff record; begin
  for staff in select user_id from public.club_members where organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid and active and role in ('owner','gym_admin','gym_staff','trainer') loop
    perform public.club_sync_madhouse_staff_access_identity(staff.user_id);
  end loop;
end $$;

commit;
