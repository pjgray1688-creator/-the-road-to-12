-- Forward-only fixes for Glow Zone staff contact corrections, linked identity
-- names, and the prepared-staff invitation attachment workflow.
-- It normalises only two confirmed prepared identity labels (Luke Morris and
-- Steve Hardy). Invitation roles, Coach permissions, work locations, customer
-- rows, and historical audit records are not changed.
begin;

do $$
begin
  if to_regclass('public.club_customers') is null
     or to_regclass('public.club_audit_events') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.club_members') is null
     or to_regclass('public.club_memberships') is null
     or to_regclass('public.club_membership_holders') is null
     or to_regclass('public.club_products') is null
     or to_regclass('public.club_locations') is null
     or to_regclass('public.club_glow_age_verifications') is null
     or to_regclass('public.club_staff_access_grants') is null
     or to_regclass('public.club_madhouse_staff_assignments') is null
     or to_regclass('public.club_madhouse_class_templates') is null
     or to_regclass('public.club_class_sessions') is null
     or to_regclass('public.club_staff_rota_shifts') is null
     or to_regclass('public.coach_permissions') is null then
    raise exception 'Required Glow Zone or staff tables are missing; no changes were applied';
  end if;
  if to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.club_capability_allowed(uuid,uuid,text)') is null
     or to_regprocedure('public.club_glow_carlton_staff_allowed(uuid)') is null
     or to_regprocedure('public.club_location_authorized(uuid,uuid)') is null
     or to_regprocedure('public.club_madhouse_list_staff_assignments(uuid)') is null
     or to_regprocedure('public.club_list_staff_accounts(uuid)') is null
     or to_regprocedure('public.club_list_schedule_staff(uuid)') is null
     or to_regprocedure('public.club_list_member_identities(uuid)') is null
     or to_regprocedure('public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid)') is null
     or to_regprocedure('public.club_madhouse_reconcile_staff_claim()') is null
     or to_regprocedure('public.club_glow_effective_age_status(uuid,uuid)') is null
     or to_regprocedure('public.club_has_active_role(uuid,text[])') is null
     or to_regprocedure('public.club_glow_age_status_secure(uuid,uuid)') is null then
    raise exception 'Required security or workflow RPC is missing; no changes were applied';
  end if;
  if pg_get_function_result(to_regprocedure('public.club_glow_age_status_secure(uuid,uuid)')) <> 'jsonb'
     or pg_get_function_result(to_regprocedure('public.club_list_schedule_staff(uuid)')) <> 'jsonb'
     or pg_get_function_result(to_regprocedure('public.club_list_member_identities(uuid)')) <> 'jsonb'
     or pg_get_function_result(to_regprocedure('public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid)')) <> 'jsonb'
     or pg_get_function_result(to_regprocedure('public.club_madhouse_reconcile_staff_claim()')) <> 'trigger'
     or regexp_replace(pg_get_function_result(to_regprocedure('public.club_list_staff_accounts(uuid)')), '\s+', '', 'g')
       <> 'TABLE(member_iduuid,user_iduuid,display_nametext,emailtext,roletext,activeboolean,is_gym_memberboolean,membership_nametext)' then
    raise exception 'An existing RPC return contract differs from the expected application contract; no changes were applied';
  end if;
  if (select coalesce(proargnames[1:pronargs],array[]::text[]) from pg_proc where oid=to_regprocedure('public.club_list_staff_accounts(uuid)')) <> array['p_organisation_id']::text[]
     or (select coalesce(proargnames[1:pronargs],array[]::text[]) from pg_proc where oid=to_regprocedure('public.club_list_schedule_staff(uuid)')) <> array['p_organisation_id']::text[]
     or (select coalesce(proargnames[1:pronargs],array[]::text[]) from pg_proc where oid=to_regprocedure('public.club_list_member_identities(uuid)')) <> array['p_organisation_id']::text[]
     or (select coalesce(proargnames[1:pronargs],array[]::text[]) from pg_proc where oid=to_regprocedure('public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid)')) <> array['p_organisation_id','p_assignment_id','p_grant_id']::text[]
     or (select coalesce(proargnames[1:pronargs],array[]::text[]) from pg_proc where oid=to_regprocedure('public.club_madhouse_reconcile_staff_claim()')) <> array[]::text[] then
    raise exception 'An existing RPC argument-name contract differs from the expected application contract; no changes were applied';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='phone')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='updated_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='first_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='last_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='email')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_customers' and column_name='date_of_birth')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='actor_user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='actor_role')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='action')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='target_type')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='target_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='metadata')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='first_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='last_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='display_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='email')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_glow_age_verifications' and column_name='verified_by')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_glow_age_verifications' and column_name='verified_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_glow_age_verifications' and column_name='status')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_glow_age_verifications' and column_name='date_of_birth')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_glow_age_verifications' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_glow_age_verifications' and column_name='user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='role')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='active')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='created_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='product_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='status')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='starts_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_memberships' and column_name='ends_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_holders' and column_name='membership_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_membership_holders' and column_name='user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_products' and column_name='name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='active')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='coach_requested')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='intended_role')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='normalized_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='canonical_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='location_ids')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='staff_grant_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='active')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='accepted_by')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='location_ids')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='display_name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='status')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_access_grants' and column_name='expires_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_madhouse_staff_assignments' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='coach_permissions' and column_name='active')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='coach_permissions' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='coach_permissions' and column_name='user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_class_sessions' and column_name='instructor_assignment_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_class_sessions' and column_name='host_user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_class_sessions' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_class_sessions' and column_name='starts_at')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_rota_shifts' and column_name='staff_assignment_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_rota_shifts' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_rota_shifts' and column_name='work_date')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_rota_shifts' and column_name='staff_user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_staff_rota_shifts' and column_name='id') then
    raise exception 'Required Glow Zone identity or audit columns are missing; no changes were applied';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.club_staff_access_grants'::regclass and tgname='club_madhouse_staff_claim_reconcile' and not tgisinternal) then
    raise exception 'Existing staff claim reconciliation trigger is missing; no changes were applied';
  end if;
end $$;

-- The existing prepared records store first names only. Normalise just the
-- two full identities confirmed for this release. Assignment IDs, rota/session
-- references, locations, linked grants, and permissions remain unchanged.
do $$
declare v_org uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'; v_id uuid; v_count integer; v_updated integer;
begin
  select count(*),min(id::text)::uuid into v_count,v_id from public.club_madhouse_staff_assignments
    where organisation_id=v_org and active and normalized_name='luke' and canonical_name='Luke';
  if v_count=1 then
    if exists(select 1 from public.club_madhouse_staff_assignments where organisation_id=v_org and normalized_name='lukemorris' and id<>v_id) then
      raise exception 'Luke Morris prepared identity conflicts with an existing assignment';
    end if;
    update public.club_madhouse_staff_assignments set canonical_name='Luke Morris',normalized_name='lukemorris'
      where id=v_id and organisation_id=v_org and active and normalized_name='luke' and canonical_name='Luke';
    get diagnostics v_updated = row_count;
    if v_updated<>1 then raise exception 'Luke prepared identity changed during guarded normalisation'; end if;
  elsif not exists(select 1 from public.club_madhouse_staff_assignments where organisation_id=v_org and active and normalized_name='lukemorris' and canonical_name='Luke Morris') then
    raise exception 'Expected one Luke prepared identity or its already-normalised form';
  end if;

  select count(*),min(id::text)::uuid into v_count,v_id from public.club_madhouse_staff_assignments
    where organisation_id=v_org and active and normalized_name='steve' and canonical_name='Steve';
  if v_count=1 then
    if exists(select 1 from public.club_madhouse_staff_assignments where organisation_id=v_org and normalized_name='stevehardy' and id<>v_id) then
      raise exception 'Steve Hardy prepared identity conflicts with an existing assignment';
    end if;
    update public.club_madhouse_staff_assignments set canonical_name='Steve Hardy',normalized_name='stevehardy'
      where id=v_id and organisation_id=v_org and active and normalized_name='steve' and canonical_name='Steve';
    get diagnostics v_updated = row_count;
    if v_updated<>1 then raise exception 'Steve prepared identity changed during guarded normalisation'; end if;
  elsif not exists(select 1 from public.club_madhouse_staff_assignments where organisation_id=v_org and active and normalized_name='stevehardy' and canonical_name='Steve Hardy') then
    raise exception 'Expected one Steve prepared identity or its already-normalised form';
  end if;
end $$;

-- Only expose a verifier's linked profile name to the same Carlton-authorised
-- Glow staff who already receive the secure age status. DOB/address remain out.
create or replace function public.club_glow_age_status_secure(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; a public.club_glow_age_verifications%rowtype; v_status text; verifier_name text;
begin
  if auth.uid() is null or not public.club_glow_carlton_staff_allowed(p_organisation_id) then
    raise exception 'Glow Zone age status is not permitted' using errcode='42501';
  end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and user_id=p_user_id;
  if not found then return null; end if;
  select * into a from public.club_glow_age_verifications where organisation_id=p_organisation_id and user_id=p_user_id;
  v_status:=public.club_glow_effective_age_status(p_organisation_id,p_user_id);
  if a.status in ('verified','under_18') and a.verified_by is not null then
    select case
      when nullif(btrim(p.first_name),'') is not null and nullif(btrim(p.last_name),'') is not null
        then concat_ws(' ',btrim(p.first_name),btrim(p.last_name))
      else coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.email),''))
    end into verifier_name
    from public.profiles p where p.id=a.verified_by;
  end if;
  return jsonb_build_object(
    'status',v_status,
    'verified_at',case when a.status in ('verified','under_18') then a.verified_at end,
    'verified_by',case when a.status in ('verified','under_18') then a.verified_by end,
    'verified_by_name',verifier_name,
    'first_name',c.first_name,'last_name',c.last_name,'email',c.email,'phone',c.phone
  );
end; $$;
revoke all on function public.club_glow_age_status_secure(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_glow_age_status_secure(uuid,uuid) to authenticated;

-- A Glow-only customer may not have a club_members row, so the generic member
-- contact RPC is not suitable. This narrow RPC edits phone only, requires both
-- membership/contact and Carlton Glow permissions, and writes a redacted audit.
create or replace function public.club_glow_update_customer_phone_secure(
  p_organisation_id uuid,p_customer_id uuid,p_phone text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; actor_role text;
begin
  if auth.uid() is null
     or not public.club_glow_carlton_staff_allowed(p_organisation_id)
     or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create') then
    raise exception 'Glow Zone customer contact editing is not permitted' using errcode='42501';
  end if;
  if p_customer_id is null or p_phone is null or length(btrim(p_phone)) not between 7 and 25
     or btrim(p_phone) !~ '^\+?[0-9][0-9 ()-]*$' then
    raise exception 'Enter a valid telephone number' using errcode='22023';
  end if;
  select * into c from public.club_customers
    where id=p_customer_id and organisation_id=p_organisation_id and user_id is not null
    for update;
  if not found then raise exception 'Glow Zone customer not found in this organisation' using errcode='P0002'; end if;
  select m.role into actor_role from public.club_members m
    where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  if actor_role is null then raise exception 'Active Club staff access is required' using errcode='42501'; end if;
  if c.phone is distinct from btrim(p_phone) then
    update public.club_customers set phone=btrim(p_phone),updated_at=now()
      where id=c.id and organisation_id=p_organisation_id returning * into c;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
      values(p_organisation_id,auth.uid(),actor_role,'glow.customer_phone_updated','customer',c.id,
        jsonb_build_object('changed_fields',jsonb_build_array('phone')));
  end if;
  return jsonb_build_object('updated',true,'phone',c.phone);
end; $$;
revoke all on function public.club_glow_update_customer_phone_secure(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.club_glow_update_customer_phone_secure(uuid,uuid,text) to authenticated;

-- Use the linked profile's full name when complete. Partial first/last fields
-- must not mask a fuller display name from the same authenticated identity.
create or replace function public.club_list_schedule_staff(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',
  case when nullif(btrim(p.first_name),'') is not null and nullif(btrim(p.last_name),'') is not null
    then concat_ws(' ',btrim(p.first_name),btrim(p.last_name))
    else coalesce(nullif(btrim(p.display_name),''),nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Instructor name unavailable') end
  ) order by p.first_name,p.last_name),'[]'::jsonb)
from public.club_members m left join public.profiles p on p.id=m.user_id
where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_admin','owner')
  and auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage');
$$;
revoke all on function public.club_list_schedule_staff(uuid) from public,anon,authenticated;
grant execute on function public.club_list_schedule_staff(uuid) to authenticated;

create or replace function public.club_list_member_identities(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Member identity directory is not permitted' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,
    'display_name',case
      when nullif(btrim(p.first_name),'') is not null and nullif(btrim(p.last_name),'') is not null
        then concat_ws(' ',btrim(p.first_name),btrim(p.last_name))
      else coalesce(nullif(btrim(p.display_name),''),nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(btrim(p.email),''))
    end,
    'email',nullif(btrim(p.email),'')) order by m.created_at)
    from public.club_members m left join public.profiles p on p.id=m.user_id
    where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;
revoke all on function public.club_list_member_identities(uuid) from public,anon,authenticated;
grant execute on function public.club_list_member_identities(uuid) to authenticated;

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
      case when nullif(btrim(p.first_name),'') is not null and nullif(btrim(p.last_name),'') is not null
        then concat_ws(' ',btrim(p.first_name),btrim(p.last_name))
        else coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.email),''),'Staff member') end,
      nullif(btrim(p.email),''),m.role,m.active,(membership.id is not null),membership.product_name
    from public.club_members m
    left join public.profiles p on p.id=m.user_id
    left join lateral (
      select ms.id,product.name product_name
      from public.club_memberships ms
      join public.club_membership_holders h on h.membership_id=ms.id and h.user_id=m.user_id
      join public.club_products product on product.id=ms.product_id and product.organisation_id=ms.organisation_id
      where ms.organisation_id=p_organisation_id and ms.status='active' and ms.starts_at<=now()
        and (ms.ends_at is null or ms.ends_at>now())
      order by ms.starts_at desc limit 1
    ) membership on true
    where m.organisation_id=p_organisation_id and m.role in ('owner','gym_admin','gym_staff','trainer')
    order by m.active desc,coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.email),''),'Staff member'),m.created_at;
end;
$$;
revoke all on function public.club_list_staff_accounts(uuid) from public,anon,authenticated;
grant execute on function public.club_list_staff_accounts(uuid) to authenticated;

-- Attach the manager-selected invitation without silently changing its role,
-- capability preset, Coach request, or venue scope. Coaches are assigned to
-- future class sessions only when the accepted grant and Coach permission both
-- say that the account is a Coach.
create or replace function public.club_madhouse_attach_staff_invitation(
  p_organisation_id uuid,p_assignment_id uuid,p_grant_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare a public.club_madhouse_staff_assignments%rowtype; g public.club_staff_access_grants%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff assignment management is not permitted' using errcode='42501';
  end if;
  select * into a from public.club_madhouse_staff_assignments
    where id=p_assignment_id and organisation_id=p_organisation_id and active for update;
  select * into g from public.club_staff_access_grants
    where id=p_grant_id and organisation_id=p_organisation_id
      and status in ('pending','accepted') and (status='accepted' or expires_at>now()) for update;
  if a.id is null or g.id is null then raise exception 'Staff assignment or valid invitation not found' using errcode='P0002'; end if;
  if lower(regexp_replace(btrim(coalesce(g.display_name,'')),'[^a-z]','','g'))<>a.normalized_name then
    raise exception 'Invitation name does not match the prepared staff identity' using errcode='22023';
  end if;
  if cardinality(a.location_ids)=0 or not (a.location_ids <@ g.location_ids)
     or exists(select 1 from unnest(a.location_ids) assigned(location_id)
       where not exists(select 1 from public.club_locations l where l.id=assigned.location_id and l.organisation_id=p_organisation_id and l.active)) then
    raise exception 'The invitation must already include the prepared identity’s active work locations' using errcode='42501';
  end if;
  if g.status='accepted' and g.accepted_by is null then raise exception 'Accepted invitation has no linked account' using errcode='55000'; end if;
  if a.staff_grant_id is not null and a.staff_grant_id<>g.id then raise exception 'A different invitation is already linked' using errcode='23505'; end if;
  update public.club_madhouse_staff_assignments set staff_grant_id=g.id where id=a.id and organisation_id=p_organisation_id;
  if g.status='accepted' then
    if g.intended_role in ('trainer','gym_admin') and g.coach_requested
       and exists(select 1 from public.coach_permissions cp where cp.organisation_id=p_organisation_id and cp.user_id=g.accepted_by and cp.active) then
      update public.club_class_sessions set host_user_id=g.accepted_by
        where organisation_id=p_organisation_id and instructor_assignment_id=a.id and host_user_id is null and starts_at>now();
    end if;
    update public.club_staff_rota_shifts set staff_user_id=g.accepted_by,staff_assignment_id=null
      where organisation_id=p_organisation_id and staff_assignment_id=a.id and work_date>=(now() at time zone 'Europe/London')::date;
  end if;
  select m.role into actor_role from public.club_members m
    where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  if actor_role is null then raise exception 'Active manager account is required' using errcode='42501'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'staff.operational_identity_linked','staff_assignment',a.id,
      jsonb_build_object('grant_id',g.id,'status',g.status,'role',g.intended_role,'coach_requested',g.coach_requested,'location_ids',g.location_ids));
  return jsonb_build_object('assignment_id',a.id,'grant_id',g.id,'status',g.status,'role',g.intended_role,'coach_requested',g.coach_requested);
end; $$;
revoke all on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) to authenticated;

create or replace function public.club_madhouse_reconcile_staff_claim()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='accepted' and old.status is distinct from new.status and new.accepted_by is not null then
    if new.intended_role in ('trainer','gym_admin') and new.coach_requested
       and exists(select 1 from public.coach_permissions cp where cp.organisation_id=new.organisation_id and cp.user_id=new.accepted_by and cp.active) then
      update public.club_class_sessions s set host_user_id=new.accepted_by
        from public.club_madhouse_staff_assignments a
        where a.organisation_id=new.organisation_id and a.staff_grant_id=new.id
          and s.organisation_id=new.organisation_id and s.instructor_assignment_id=a.id and s.host_user_id is null and s.starts_at>now();
    end if;
    update public.club_staff_rota_shifts r set staff_user_id=new.accepted_by,staff_assignment_id=null
      from public.club_madhouse_staff_assignments a
      where a.organisation_id=new.organisation_id and a.staff_grant_id=new.id
        and r.organisation_id=new.organisation_id and r.staff_assignment_id=a.id
        and r.work_date>=(now() at time zone 'Europe/London')::date;
  end if;
  return new;
end; $$;

commit;
