-- MANUAL, REVIEWED FIRST-ORGANISATION BOOTSTRAP. DO NOT ADD TO THE MIGRATION CHAIN.
--
-- Intended use after all repository migrations have been reviewed and applied:
-- 1. The first manager creates and confirms their own R12 account normally.
-- 2. In Supabase Authentication, copy that existing user's UUID and verified email.
-- 3. Replace the three REPLACE_... values below and review the explicit Coach flag.
-- 4. Review the script, then run it once in the Supabase SQL editor as a trusted
--    administrator. It is idempotent and refuses an unknown/mismatched Auth user.
-- 5. Sign in as that user and use Club -> Staff for every remaining staff account.
--
-- This creates no auth.users row, Coach permission, gym membership or entitlement.

do $bootstrap$
declare
  v_user_id_text text := 'REPLACE_WITH_EXISTING_AUTH_USER_UUID';
  v_user_email text := 'REPLACE_WITH_EXISTING_AUTH_USER_EMAIL';
  v_display_name text := 'REPLACE_WITH_MANAGER_DISPLAY_NAME';
  v_grant_coach boolean := false; -- change explicitly to true only if Peter should coach
  v_user_id uuid;
  v_organisation_id uuid;
begin
  if v_user_id_text like 'REPLACE_%'
    or v_user_email like 'REPLACE_%'
    or v_display_name like 'REPLACE_%'
  then
    raise exception 'Replace every bootstrap input before running this script';
  end if;
  v_user_id:=v_user_id_text::uuid;
  v_user_email:=lower(btrim(v_user_email));
  v_display_name:=btrim(v_display_name);
  if v_user_email='' or v_display_name='' then
    raise exception 'Bootstrap email and display name are required';
  end if;
  if not exists(
    select 1 from auth.users
    where id=v_user_id and lower(btrim(email))=v_user_email and email_confirmed_at is not null
  ) then
    raise exception 'The supplied UUID/email does not match an existing Supabase Auth user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('r12:madhouse-gym:first-organisation-bootstrap',0));

  insert into public.club_organisations(name,slug,active)
  values('Madhouse Gym','madhouse-gym',true)
  on conflict (slug) do update set active=true
  returning id into v_organisation_id;

  insert into public.club_locations(organisation_id,name,active)
  values(v_organisation_id,'Rotherham',true)
  on conflict (organisation_id,name) do update set active=true;

  insert into public.profiles(id,email,display_name)
  values(v_user_id,v_user_email,v_display_name)
  on conflict (id) do update set
    email=excluded.email,
    display_name=coalesce(nullif(btrim(public.profiles.display_name),''),excluded.display_name);

  insert into public.club_members(organisation_id,user_id,role,active)
  values(v_organisation_id,v_user_id,'gym_admin',true)
  on conflict (organisation_id,user_id) do update set
    role=case when public.club_members.role='owner' then 'owner' else 'gym_admin' end,
    active=true;

  if v_grant_coach then
    insert into public.coach_permissions(organisation_id,user_id,granted_by,active)
    values(v_organisation_id,v_user_id,v_user_id,true)
    on conflict (organisation_id,user_id) do update set active=true,granted_by=excluded.granted_by;
  end if;

  insert into public.club_audit_events(
    organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata
  )
  select
    v_organisation_id,v_user_id,'gym_admin','organisation.initial_manager_bootstrapped',
    'club_organisation',v_organisation_id,
    jsonb_build_object('method','reviewed_manual_sql','email',v_user_email)
  where not exists(
    select 1 from public.club_audit_events
    where organisation_id=v_organisation_id
      and action='organisation.initial_manager_bootstrapped'
      and actor_user_id=v_user_id
  );

  if v_grant_coach and not exists(
    select 1 from public.club_audit_events where organisation_id=v_organisation_id
      and action='coach.access_changed' and target_type='club_member' and target_id=v_user_id
      and metadata->>'source'='first-organisation-bootstrap'
  ) then
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(v_organisation_id,v_user_id,'gym_admin','coach.access_changed','club_member',v_user_id,
      jsonb_build_object('active',true,'source','first-organisation-bootstrap'));
  end if;

  raise notice 'Madhouse Gym ready: organisation %, initial manager %',v_organisation_id,v_user_id;
end;
$bootstrap$;
