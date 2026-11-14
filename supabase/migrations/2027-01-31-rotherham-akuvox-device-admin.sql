-- Owner/admin management for the Rotherham Akuvox gateway device record.
-- New devices are registered disabled. This migration does not change venue
-- access mode, memberships, PINs, devices, or other live records.
begin;

do $$
begin
  if to_regclass('public.club_access_devices') is null
     or to_regclass('public.club_locations') is null
     or to_regclass('public.club_organisations') is null
     or to_regclass('public.club_members') is null
     or to_regclass('public.club_audit_events') is null then
    raise exception 'Akuvox administration prerequisites are missing';
  end if;
  if to_regprocedure('public.club_has_active_role(uuid,text[])') is null then
    raise exception 'Active Club role checker is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='organisation_id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='location_id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='provider_key')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='secret_hash' and data_type='bytea')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='status')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='created_by')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='created_at')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_access_devices' and column_name='last_seen_at')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='active')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_locations' and column_name='access_mode')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_organisations' and column_name='id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_organisations' and column_name='slug')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='user_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='role')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='active')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='organisation_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='actor_user_id')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='club_audit_events' and column_name='actor_role') then
    raise exception 'Akuvox administration table columns do not match the deployed contract';
  end if;
  if to_regprocedure('public.club_provision_rotherham_akuvox_device(uuid,uuid,uuid,text,bytea)') is not null
     and pg_get_function_result(to_regprocedure('public.club_provision_rotherham_akuvox_device(uuid,uuid,uuid,text,bytea)')) <> 'uuid' then
    raise exception 'Existing Akuvox provision RPC has an incompatible return type';
  end if;
  if to_regprocedure('public.club_list_rotherham_akuvox_devices(uuid)') is not null
     and pg_get_function_result(to_regprocedure('public.club_list_rotherham_akuvox_devices(uuid)')) <> 'jsonb' then
    raise exception 'Existing Akuvox list RPC has an incompatible return type';
  end if;
  if to_regprocedure('public.club_set_rotherham_akuvox_device_status(uuid,uuid,text,text)') is not null
     and pg_get_function_result(to_regprocedure('public.club_set_rotherham_akuvox_device_status(uuid,uuid,text,text)')) <> 'jsonb' then
    raise exception 'Existing Akuvox status RPC has an incompatible return type';
  end if;
end;
$$;

create or replace function public.club_provision_rotherham_akuvox_device(
  p_organisation_id uuid,
  p_location_id uuid,
  p_device_id uuid,
  p_name text,
  p_secret_hash bytea
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
  actor_role text;
  location_name text;
  rotherham_count integer;
  existing public.club_access_devices%rowtype;
  event_action text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin']) then
    raise exception 'Device administration requires an active owner or gym admin' using errcode='42501';
  end if;
  select m.role into actor_role from public.club_members m
   where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin');
  if actor_role is null then raise exception 'Active owner or gym admin is required' using errcode='42501'; end if;
  if p_device_id is null or p_secret_hash is null or octet_length(p_secret_hash)<>32
     or nullif(btrim(p_name),'') is null or length(btrim(p_name))>80 then
    raise exception 'Invalid device details' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_organisations o where o.id=p_organisation_id and o.slug='madhouse-gym') then
    raise exception 'This device workflow is limited to Madhouse Gym' using errcode='42501';
  end if;
  select count(*) into rotherham_count from public.club_locations l join public.club_organisations o on o.id=l.organisation_id
   where l.organisation_id=p_organisation_id and o.slug='madhouse-gym' and l.active and lower(btrim(l.name))='rotherham';
  if rotherham_count<>1 then raise exception 'Exactly one active Madhouse Rotherham location is required' using errcode='22023'; end if;
  select l.name into location_name from public.club_locations l
   where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))='rotherham' for share;
  if location_name is null then raise exception 'Active Rotherham location not found in this organisation' using errcode='22023'; end if;

  -- Serialise retries using the caller-generated device UUID. A retry may
  -- replace a still-disabled row's hash so a lost one-time response can recover.
  perform pg_advisory_xact_lock(hashtextextended(p_device_id::text,0));
  select * into existing from public.club_access_devices d where d.id=p_device_id for update;
  if found then
    if existing.organisation_id<>p_organisation_id or existing.location_id<>p_location_id or existing.status<>'disabled' then
      raise exception 'Device identifier is already assigned or active' using errcode='23505';
    end if;
    update public.club_access_devices set name=btrim(p_name),secret_hash=p_secret_hash
     where id=p_device_id and organisation_id=p_organisation_id and location_id=p_location_id;
    event_action:='access.device_secret_rotated';
  else
    insert into public.club_access_devices(id,organisation_id,location_id,name,secret_hash,status,created_by)
     values(p_device_id,p_organisation_id,p_location_id,btrim(p_name),p_secret_hash,'disabled',auth.uid());
    event_action:='access.device_provisioned';
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,metadata)
   values(p_organisation_id,auth.uid(),actor_role,event_action,'access_device',p_device_id,p_location_id,
     jsonb_build_object('status','disabled','location_name',location_name));
  return p_device_id;
end;
$$;

create or replace function public.club_list_rotherham_akuvox_devices(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare location_row record; device_list jsonb; location_count integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin']) then
    raise exception 'Device administration requires an active owner or gym admin' using errcode='42501';
  end if;
  select count(*) into location_count
   from public.club_locations l join public.club_organisations o on o.id=l.organisation_id
   where l.organisation_id=p_organisation_id and o.slug='madhouse-gym' and lower(btrim(l.name))='rotherham';
  if location_count<>1 then raise exception 'Exactly one Madhouse Rotherham location is required' using errcode='P0002'; end if;
  select l.id,l.name,l.active,l.access_mode into location_row
   from public.club_locations l join public.club_organisations o on o.id=l.organisation_id
   where l.organisation_id=p_organisation_id and o.slug='madhouse-gym' and lower(btrim(l.name))='rotherham';
  if not found then raise exception 'Madhouse Rotherham location not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'name',d.name,'status',d.status,'locationId',d.location_id,
    'createdAt',d.created_at,'lastSeenAt',d.last_seen_at
  ) order by d.created_at desc),'[]'::jsonb) into device_list
  from public.club_access_devices d where d.organisation_id=p_organisation_id and d.location_id=location_row.id;
  return jsonb_build_object('location',jsonb_build_object(
    'id',location_row.id,'name',location_row.name,'active',location_row.active,'accessMode',location_row.access_mode
  ),'devices',device_list);
end;
$$;

create or replace function public.club_set_rotherham_akuvox_device_status(
  p_organisation_id uuid,p_device_id uuid,p_status text,p_reason text default null
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text; device_row public.club_access_devices%rowtype; location_mode text; rotherham_id uuid; rotherham_count integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner','gym_admin']) then
    raise exception 'Device administration requires an active owner or gym admin' using errcode='42501';
  end if;
  select m.role into actor_role from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('owner','gym_admin');
  if actor_role is null then raise exception 'Active owner or gym admin is required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('active','disabled') then raise exception 'Invalid device status' using errcode='22023'; end if;
  if p_status='disabled' and nullif(btrim(p_reason),'') is null then raise exception 'A reason is required to disable a device' using errcode='22023'; end if;
  select count(*) into rotherham_count
   from public.club_locations l join public.club_organisations o on o.id=l.organisation_id
   where l.organisation_id=p_organisation_id and o.slug='madhouse-gym' and lower(btrim(l.name))='rotherham';
  if rotherham_count<>1 then raise exception 'Exactly one Madhouse Rotherham location is required' using errcode='P0002'; end if;
  select l.id into rotherham_id from public.club_locations l where l.organisation_id=p_organisation_id and lower(btrim(l.name))='rotherham';
  select dev.* into device_row from public.club_access_devices dev
   join public.club_locations l on l.id=dev.location_id and l.organisation_id=dev.organisation_id
   join public.club_organisations o on o.id=dev.organisation_id
   where dev.id=p_device_id and dev.organisation_id=p_organisation_id and dev.location_id=rotherham_id and o.slug='madhouse-gym' and lower(btrim(l.name))='rotherham'
   for update of dev;
  if not found then raise exception 'Rotherham device not found in this organisation' using errcode='P0002'; end if;
  select l.access_mode into location_mode from public.club_locations l where l.id=device_row.location_id and l.organisation_id=p_organisation_id;
  if p_status='active' and (location_mode<>'CHECKIN_ONLY' or not exists(select 1 from public.club_locations l where l.id=device_row.location_id and l.organisation_id=p_organisation_id and l.active)) then
    raise exception 'Device can only be activated while Rotherham remains check-in only' using errcode='42501';
  end if;
  if device_row.status<>p_status then
    update public.club_access_devices set status=p_status where id=device_row.id and organisation_id=p_organisation_id returning * into device_row;
    insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
     values(p_organisation_id,auth.uid(),actor_role,case when p_status='disabled' then 'access.device_revoked' else 'access.device_activated' end,
       'access_device',device_row.id,device_row.location_id,nullif(btrim(p_reason),''),jsonb_build_object('status',p_status,'location_access_mode',location_mode));
  end if;
  return jsonb_build_object('id',device_row.id,'status',device_row.status,'locationId',device_row.location_id,'locationAccessMode',location_mode);
end;
$$;

revoke all on function public.club_provision_rotherham_akuvox_device(uuid,uuid,uuid,text,bytea) from public,anon,service_role;
revoke all on function public.club_list_rotherham_akuvox_devices(uuid) from public,anon,service_role;
revoke all on function public.club_set_rotherham_akuvox_device_status(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.club_provision_rotherham_akuvox_device(uuid,uuid,uuid,text,bytea) to authenticated;
grant execute on function public.club_list_rotherham_akuvox_devices(uuid) to authenticated;
grant execute on function public.club_set_rotherham_akuvox_device_status(uuid,uuid,text,text) to authenticated;

commit;
