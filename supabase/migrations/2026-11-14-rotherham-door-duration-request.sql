-- Persist the R12-requested relay hold duration and an owner/admin manual
-- hardware read-back. This migration never configures or operates the relay.
begin;

do $$
begin
  if to_regclass('public.club_locations') is null
     or to_regclass('public.club_organisations') is null
     or to_regclass('public.club_members') is null
     or to_regclass('public.club_audit_events') is null
     or to_regprocedure('public.club_has_active_role(uuid,text[])') is null then
    raise exception 'Rotherham door-duration prerequisites are missing';
  end if;
  if pg_get_function_result(to_regprocedure('public.club_has_active_role(uuid,text[])'))<>'boolean' then
    raise exception 'Active Club role checker return type does not match the deployed contract';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='organisation_id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='name')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='active')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='access_mode')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='role')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='active')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='actor_role') then
    raise exception 'Rotherham door-duration columns do not match the deployed contract';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_organisations' and column_name='id' and data_type='uuid')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_organisations' and column_name='slug')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='organisation_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='actor_user_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='action')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='target_type')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='target_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='location_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='metadata') then
    raise exception 'Rotherham door-duration organisation/audit dependencies do not match the deployed contract';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.club_locations'::regclass and c.contype='u'
     and pg_get_constraintdef(c.oid)='UNIQUE (id, organisation_id)') then
    raise exception 'Organisation-scoped club_locations key is missing';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Supabase auth.users is unavailable for audited actor references';
  end if;
end;
$$;

create table if not exists public.club_rotherham_door_duration_requests (
  organisation_id uuid not null references public.club_organisations(id) on delete restrict,
  location_id uuid not null,
  requested_seconds smallint not null default 5 check(requested_seconds between 3 and 10),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  hardware_readback_seconds smallint check(hardware_readback_seconds between 3 and 10),
  hardware_verified_by uuid references auth.users(id) on delete set null,
  hardware_verified_at timestamptz,
  primary key(organisation_id,location_id),
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  check((hardware_readback_seconds is null and hardware_verified_by is null and hardware_verified_at is null)
     or (hardware_readback_seconds=requested_seconds and hardware_verified_by is not null and hardware_verified_at is not null))
);
alter table public.club_rotherham_door_duration_requests enable row level security;
revoke all on public.club_rotherham_door_duration_requests from public,anon,authenticated,service_role;

do $$
declare org_id uuid; location_id uuid; location_count integer;
begin
  select id into org_id from public.club_organisations where slug='madhouse-gym';
  select count(*) into location_count from public.club_locations l
   where l.organisation_id=org_id and l.active and lower(btrim(l.name))='rotherham';
  if org_id is null or location_count<>1 then
    raise exception 'Exactly one active Madhouse Rotherham location is required';
  end if;
  select l.id into location_id from public.club_locations l
   where l.organisation_id=org_id and l.active and lower(btrim(l.name))='rotherham';
  insert into public.club_rotherham_door_duration_requests(organisation_id,location_id,requested_seconds)
   values(org_id,location_id,5) on conflict(organisation_id,location_id) do nothing;
end;
$$;

create or replace function public.club_get_rotherham_door_duration_request(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text; location_row record; setting_row public.club_rotherham_door_duration_requests%rowtype; location_count integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin']) then
    raise exception 'Door settings require an active owner or gym admin' using errcode='42501';
  end if;
  select m.role into actor_role from public.club_members m
   where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin');
  if actor_role is null or not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.slug='madhouse-gym') then
    raise exception 'Door settings are limited to Madhouse owner/admin accounts' using errcode='42501';
  end if;
  select count(*) into location_count from public.club_locations l
   where l.organisation_id=p_organisation_id and lower(btrim(l.name))='rotherham';
  if location_count<>1 then raise exception 'Exactly one Madhouse Rotherham location is required' using errcode='P0002'; end if;
  select l.id,l.name,l.active,l.access_mode into location_row from public.club_locations l
   where l.organisation_id=p_organisation_id and lower(btrim(l.name))='rotherham';
  if not found then raise exception 'Rotherham location not found' using errcode='P0002'; end if;
  select * into setting_row from public.club_rotherham_door_duration_requests s
   where s.organisation_id=p_organisation_id and s.location_id=location_row.id;
  return jsonb_build_object(
    'locationId',location_row.id,'locationActive',location_row.active,'accessMode',location_row.access_mode,
    'requestedSeconds',coalesce(setting_row.requested_seconds,5),
    'saved',setting_row.organisation_id is not null,
    'hardwareVerified',setting_row.hardware_verified_at is not null,
    'hardwareReadbackSeconds',setting_row.hardware_readback_seconds,
    'hardwareVerifiedAt',setting_row.hardware_verified_at
  );
end;
$$;

create or replace function public.club_set_rotherham_door_duration_request(p_organisation_id uuid,p_seconds integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text; v_location_id uuid; previous_seconds smallint; changed boolean; location_count integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin']) then
    raise exception 'Door settings require an active owner or gym admin' using errcode='42501';
  end if;
  select m.role into actor_role from public.club_members m
   where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin');
  if actor_role is null or not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.slug='madhouse-gym') then
    raise exception 'Door settings are limited to Madhouse owner/admin accounts' using errcode='42501';
  end if;
  if p_seconds is null or p_seconds not between 3 and 10 then raise exception 'Door duration must be between 3 and 10 seconds' using errcode='22023'; end if;
  select count(*) into location_count from public.club_locations l
   where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))='rotherham';
  if location_count<>1 then raise exception 'Exactly one active Madhouse Rotherham location is required' using errcode='P0002'; end if;
  select l.id into v_location_id from public.club_locations l
   where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))='rotherham' for update;
  if not found then raise exception 'Active Rotherham location not found' using errcode='P0002'; end if;
  select s.requested_seconds into previous_seconds from public.club_rotherham_door_duration_requests s
   where s.organisation_id=p_organisation_id and s.location_id=v_location_id for update;
  changed:=previous_seconds is distinct from p_seconds::smallint;
  insert into public.club_rotherham_door_duration_requests(organisation_id,location_id,requested_seconds,updated_by,updated_at)
   values(p_organisation_id,v_location_id,p_seconds::smallint,auth.uid(),now())
   on conflict(organisation_id,location_id) do update set requested_seconds=excluded.requested_seconds,
     updated_by=excluded.updated_by,updated_at=excluded.updated_at,
     hardware_readback_seconds=case when club_rotherham_door_duration_requests.requested_seconds<>excluded.requested_seconds then null else club_rotherham_door_duration_requests.hardware_readback_seconds end,
     hardware_verified_by=case when club_rotherham_door_duration_requests.requested_seconds<>excluded.requested_seconds then null else club_rotherham_door_duration_requests.hardware_verified_by end,
     hardware_verified_at=case when club_rotherham_door_duration_requests.requested_seconds<>excluded.requested_seconds then null else club_rotherham_door_duration_requests.hardware_verified_at end;
  if changed then
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,metadata)
     values(p_organisation_id,auth.uid(),actor_role,'access.door_duration_requested','location',v_location_id,v_location_id,
       jsonb_build_object('previous_seconds',previous_seconds,'requested_seconds',p_seconds,'hardware_changed',false));
  end if;
  return jsonb_build_object('locationId',v_location_id,'requestedSeconds',p_seconds,'hardwareVerified',not changed and exists(
    select 1 from public.club_rotherham_door_duration_requests s where s.organisation_id=p_organisation_id and s.location_id=v_location_id and s.hardware_verified_at is not null));
end;
$$;

create or replace function public.club_confirm_rotherham_door_duration_readback(p_organisation_id uuid,p_observed_seconds integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text; v_location_id uuid; current_seconds smallint; location_count integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin']) then
    raise exception 'Hardware read-back requires an active owner or gym admin' using errcode='42501';
  end if;
  select m.role into actor_role from public.club_members m
   where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin');
  if actor_role is null or not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.slug='madhouse-gym') then
    raise exception 'Hardware read-back is limited to Madhouse owner/admin accounts' using errcode='42501';
  end if;
  if p_observed_seconds is null or p_observed_seconds not between 3 and 10 then raise exception 'Observed duration must be between 3 and 10 seconds' using errcode='22023'; end if;
  select count(*) into location_count from public.club_locations l
   where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))='rotherham';
  if location_count<>1 then raise exception 'Exactly one active Madhouse Rotherham location is required' using errcode='P0002'; end if;
  select l.id into v_location_id from public.club_locations l
   where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))='rotherham';
  if not found then raise exception 'Active Rotherham location not found' using errcode='P0002'; end if;
  select s.requested_seconds into current_seconds from public.club_rotherham_door_duration_requests s
   where s.organisation_id=p_organisation_id and s.location_id=v_location_id for update;
  if current_seconds is null then raise exception 'Save the requested duration before confirming hardware' using errcode='P0002'; end if;
  if current_seconds<>p_observed_seconds then raise exception 'Device read-back does not match the saved R12 request' using errcode='22023'; end if;
  update public.club_rotherham_door_duration_requests set hardware_readback_seconds=p_observed_seconds::smallint,
    hardware_verified_by=auth.uid(),hardware_verified_at=now()
   where organisation_id=p_organisation_id and location_id=v_location_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,metadata)
   values(p_organisation_id,auth.uid(),actor_role,'access.door_duration_hardware_readback','location',v_location_id,v_location_id,
     jsonb_build_object('requested_seconds',current_seconds,'observed_seconds',p_observed_seconds,'verification_method','manual_device_readback'));
  return jsonb_build_object('locationId',v_location_id,'requestedSeconds',current_seconds,'hardwareReadbackSeconds',p_observed_seconds,'hardwareVerified',true,'verificationMethod','manual_device_readback');
end;
$$;

revoke all on function public.club_get_rotherham_door_duration_request(uuid),public.club_set_rotherham_door_duration_request(uuid,integer),public.club_confirm_rotherham_door_duration_readback(uuid,integer) from public,anon,service_role;
grant execute on function public.club_get_rotherham_door_duration_request(uuid),public.club_set_rotherham_door_duration_request(uuid,integer),public.club_confirm_rotherham_door_duration_readback(uuid,integer) to authenticated;

commit;
