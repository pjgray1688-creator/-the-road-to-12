-- Complete the existing staff access-grant workflow with explicit Coach intent,
-- profile creation, safe claiming, management reads and attributable Coach audit.

alter table public.club_staff_access_grants
  add column if not exists coach_requested boolean not null default false,
  add column if not exists member_intent boolean not null default false;

drop function if exists public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]);

create or replace function public.club_create_staff_access_grant(
  p_organisation_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_location_ids uuid[],
  p_capabilities text[],
  p_coach_requested boolean,
  p_member_intent boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; expected text[]; normalized_email text:=lower(btrim(p_email));
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff access requires staff-management permission' using errcode='42501';
  end if;
  if p_role not in ('gym_staff','gym_admin','trainer') or normalized_email is null or normalized_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(btrim(p_display_name),'') is null then
    raise exception 'Invalid staff access request' using errcode='22023';
  end if;
  if coalesce(p_coach_requested,false) and p_role not in ('gym_admin','trainer') then
    raise exception 'Coach access is unavailable for this staff role' using errcode='22023';
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
  if exists(
    select 1 from public.club_members m
    join public.profiles p on p.id=m.user_id
    where m.organisation_id=p_organisation_id and m.active
      and m.role in ('owner','gym_admin','gym_staff','trainer')
      and lower(btrim(p.email))=normalized_email
  ) then raise exception 'That account already has active staff access' using errcode='23505'; end if;
  update public.club_staff_access_grants set status='expired'
    where organisation_id=p_organisation_id and email_normalized=normalized_email
      and status='pending' and expires_at<=now();
  if exists(select 1 from public.club_staff_access_grants where organisation_id=p_organisation_id and email_normalized=normalized_email and status='pending') then
    raise exception 'Staff access is already pending for this email' using errcode='23505';
  end if;
  insert into public.club_staff_access_grants(
    organisation_id,email_normalized,display_name,intended_role,location_ids,capabilities,
    coach_requested,member_intent,created_by
  ) values(
    p_organisation_id,normalized_email,left(btrim(p_display_name),160),p_role,
    coalesce(p_location_ids,'{}'),expected,coalesce(p_coach_requested,false),
    coalesce(p_member_intent,false),auth.uid()
  ) returning * into g;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.access_grant_created','staff_access_grant',g.id,
    jsonb_build_object('role',p_role,'email',normalized_email,'coach_requested',g.coach_requested,'member_intent',g.member_intent)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return to_jsonb(g);
end;
$$;
revoke all on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[],boolean,boolean) from public,anon;
grant execute on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[],boolean,boolean) to authenticated;

create or replace function public.club_claim_staff_access_grant(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  g public.club_staff_access_grants%rowtype;
  account_email text;
  account_metadata jsonb;
  profile_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email),coalesce(raw_user_meta_data,'{}'::jsonb)
    into account_email,account_metadata from auth.users where id=auth.uid();
  select * into g from public.club_staff_access_grants
    where id=p_grant_id and status='pending' and expires_at>now()
      and email_normalized=lower(btrim(account_email)) for update;
  if not found then raise exception 'Staff access grant is unavailable for this account' using errcode='42501'; end if;
  if g.capabilities is distinct from public.club_capabilities_for_role(g.intended_role) then
    raise exception 'Staff access grant has an invalid permission package' using errcode='42501';
  end if;
  if g.coach_requested and g.intended_role not in ('gym_admin','trainer') then
    raise exception 'Staff access grant has invalid Coach intent' using errcode='42501';
  end if;
  if exists(
    select 1 from public.club_members
    where organisation_id=g.organisation_id and user_id=auth.uid() and active
      and role in ('owner','gym_admin','gym_staff','trainer')
  ) then
    raise exception 'This account already has active staff access' using errcode='23505';
  end if;
  profile_name:=coalesce(
    nullif(btrim(g.display_name),''),
    nullif(btrim(account_metadata->>'display_name'),''),
    nullif(btrim(concat_ws(' ',account_metadata->>'first_name',account_metadata->>'last_name')),''),
    split_part(account_email,'@',1)
  );
  insert into public.profiles(id,email,display_name,first_name,last_name)
  values(
    auth.uid(),account_email,profile_name,
    nullif(btrim(account_metadata->>'first_name'),''),
    nullif(btrim(account_metadata->>'last_name'),'')
  )
  on conflict (id) do update set
    email=excluded.email,
    display_name=coalesce(nullif(btrim(public.profiles.display_name),''),excluded.display_name),
    first_name=coalesce(nullif(btrim(public.profiles.first_name),''),excluded.first_name),
    last_name=coalesce(nullif(btrim(public.profiles.last_name),''),excluded.last_name);
  insert into public.club_members(organisation_id,user_id,role,active)
  values(g.organisation_id,auth.uid(),g.intended_role,true)
  on conflict (organisation_id,user_id) do update set role=excluded.role,active=true;
  delete from public.club_staff_location_access where organisation_id=g.organisation_id and user_id=auth.uid();
  insert into public.club_staff_location_access(organisation_id,user_id,location_id)
    select g.organisation_id,auth.uid(),x from unnest(g.location_ids) x on conflict do nothing;
  delete from public.club_staff_permission_overrides where organisation_id=g.organisation_id and user_id=auth.uid();
  insert into public.coach_permissions(organisation_id,user_id,granted_by,active)
  values(g.organisation_id,auth.uid(),g.created_by,g.coach_requested)
  on conflict (organisation_id,user_id) do update
    set active=excluded.active,granted_by=excluded.granted_by;
  update public.club_staff_access_grants set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=g.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(
    g.organisation_id,auth.uid(),g.intended_role,'staff.access_grant_claimed','staff_access_grant',g.id,
    jsonb_build_object('role',g.intended_role,'coach_requested',g.coach_requested,'prepared_by',g.created_by)
  );
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(
    g.organisation_id,auth.uid(),g.intended_role,'coach.access_changed','club_member',auth.uid(),
    jsonb_build_object('active',g.coach_requested,'source','staff_access_grant','prepared_by',g.created_by)
  );
  return jsonb_build_object(
    'id',g.id,'organisation_id',g.organisation_id,'role',g.intended_role,
    'coach_active',g.coach_requested,'member_intent',g.member_intent,'status','accepted'
  );
end;
$$;
revoke all on function public.club_claim_staff_access_grant(uuid) from public,anon;
grant execute on function public.club_claim_staff_access_grant(uuid) to authenticated;

create or replace function public.coach_grant_permission(p_organisation_id uuid,p_user_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.coach_permissions%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Coach permission administration denied' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.club_members
    where organisation_id=p_organisation_id and user_id=p_user_id and active
      and role in ('trainer','gym_admin','owner')
  ) then raise exception 'Coach user is not eligible' using errcode='42501'; end if;
  select role into actor_role from public.club_members
    where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.coach_permissions(organisation_id,user_id,granted_by,active)
  values(p_organisation_id,p_user_id,auth.uid(),p_active)
  on conflict (organisation_id,user_id) do update
    set active=excluded.active,granted_by=excluded.granted_by
  returning * into result;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'coach.access_changed','club_member',p_user_id,jsonb_build_object('active',p_active));
  return to_jsonb(result);
end;
$$;
revoke all on function public.coach_grant_permission(uuid,uuid,boolean) from public,anon;
grant execute on function public.coach_grant_permission(uuid,uuid,boolean) to authenticated;

create or replace function public.club_list_my_pending_staff_access()
returns table(
  id uuid,organisation_id uuid,organisation_name text,display_name text,intended_role text,
  location_ids uuid[],coach_requested boolean,member_intent boolean,expires_at timestamptz
) language sql stable security definer set search_path=pg_catalog,public as $$
  select g.id,g.organisation_id,o.name,g.display_name,g.intended_role,g.location_ids,
    g.coach_requested,g.member_intent,g.expires_at
  from public.club_staff_access_grants g
  join public.club_organisations o on o.id=g.organisation_id and o.active
  where auth.uid() is not null
    and g.email_normalized=lower(btrim(coalesce(auth.jwt()->>'email','')))
    and g.status='pending' and g.expires_at>now()
  order by g.created_at;
$$;
revoke all on function public.club_list_my_pending_staff_access() from public,anon;
grant execute on function public.club_list_my_pending_staff_access() to authenticated;

create or replace function public.club_list_staff_accounts(p_organisation_id uuid)
returns table(
  member_id uuid,user_id uuid,display_name text,email text,role text,active boolean,
  is_gym_member boolean,membership_name text
) language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff account directory is not permitted' using errcode='42501';
  end if;
  return query
    select m.id,m.user_id,
      coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.email),''),'Staff member'),
      nullif(btrim(p.email),''),m.role,m.active,(membership.id is not null),membership.product_name
    from public.club_members m
    left join public.profiles p on p.id=m.user_id
    left join lateral (
      select ms.id,product.name product_name
      from public.club_memberships ms
      join public.club_membership_holders h on h.membership_id=ms.id and h.user_id=m.user_id
      join public.club_products product on product.id=ms.product_id and product.organisation_id=ms.organisation_id
      where ms.organisation_id=p_organisation_id
        and ms.status='active' and ms.starts_at<=now() and (ms.ends_at is null or ms.ends_at>now())
      order by ms.starts_at desc limit 1
    ) membership on true
    where m.organisation_id=p_organisation_id and m.role in ('owner','gym_admin','gym_staff','trainer')
    order by m.active desc,coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.email),''),'Staff member'),m.created_at;
end;
$$;
revoke all on function public.club_list_staff_accounts(uuid) from public,anon;
grant execute on function public.club_list_staff_accounts(uuid) to authenticated;
