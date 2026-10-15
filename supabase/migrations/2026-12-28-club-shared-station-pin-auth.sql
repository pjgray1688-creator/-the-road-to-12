-- Shared Club stations use a staff-specific PIN, but issue a fresh Supabase Auth
-- session for the selected staff account. PINs never become a client session.
create table if not exists public.club_shared_stations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null references public.club_locations(id) on delete restrict,
  station_name text not null check (length(btrim(station_name)) between 2 and 80),
  token_hash bytea not null,
  enabled boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organisation_id, station_name),
  unique (id, organisation_id)
);

create table if not exists public.club_station_staff_pins (
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

alter table public.club_shared_stations enable row level security;
alter table public.club_station_staff_pins enable row level security;
revoke all on public.club_shared_stations, public.club_station_staff_pins from public, anon, authenticated;

create or replace function public.club_station_set_my_pin(p_organisation_id uuid,p_pin text)
returns void language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare v_role text; v_auth_time bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits' using errcode='22023'; end if;
  v_auth_time:=nullif(auth.jwt()->>'auth_time','')::bigint;
  if v_auth_time is null or v_auth_time < extract(epoch from now())::bigint-300 then raise exception 'Please confirm your account password before changing your Club PIN' using errcode='42501'; end if;
  select role into v_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active and role in ('owner','gym_admin','gym_staff','trainer');
  if v_role is null then raise exception 'Active Club staff access required' using errcode='42501'; end if;
  insert into public.club_station_staff_pins(organisation_id,user_id,pin_hash,failed_attempts,locked_until,enabled,updated_at)
  values(p_organisation_id,auth.uid(),extensions.crypt(p_pin,extensions.gen_salt('bf',12)),0,null,true,now())
  on conflict(organisation_id,user_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,enabled=true,updated_at=now();
end; $$;

create or replace function public.club_station_disable_my_pin(p_organisation_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_auth_time bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  v_auth_time:=nullif(auth.jwt()->>'auth_time','')::bigint;
  if v_auth_time is null or v_auth_time < extract(epoch from now())::bigint-300 then raise exception 'Please confirm your account password before changing your Club PIN' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active and role in ('owner','gym_admin','gym_staff','trainer')) then raise exception 'Active Club staff access required' using errcode='42501'; end if;
  update public.club_station_staff_pins set enabled=false,failed_attempts=0,locked_until=null,updated_at=now() where organisation_id=p_organisation_id and user_id=auth.uid();
end; $$;

create or replace function public.club_station_my_pin_status(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,auth as $$
  select exists(select 1 from public.club_station_staff_pins p join public.club_members m on m.organisation_id=p.organisation_id and m.user_id=p.user_id and m.active where p.organisation_id=p_organisation_id and p.user_id=auth.uid() and p.enabled)
$$;

create or replace function public.club_register_shared_station(p_organisation_id uuid,p_location_id uuid,p_station_name text,p_token_hash bytea)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Station management access denied' using errcode='42501'; end if;
  if length(btrim(coalesce(p_station_name,''))) not between 2 and 80 or octet_length(p_token_hash)<>32 then raise exception 'Enter a valid station name and secure station token' using errcode='22023'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Station location must be active in this organisation' using errcode='22023'; end if;
  insert into public.club_shared_stations(organisation_id,location_id,station_name,token_hash,created_by)
  values(p_organisation_id,p_location_id,btrim(p_station_name),p_token_hash,auth.uid())
  on conflict(organisation_id,station_name) do update set location_id=excluded.location_id,token_hash=excluded.token_hash,enabled=true,created_by=excluded.created_by,created_at=now()
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.club_station_list_staff(p_station_id uuid,p_token text)
returns table(user_id uuid,first_name text,avatar_url text)
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare v_org uuid;
begin
  select s.organisation_id into v_org from public.club_shared_stations s where s.id=p_station_id and s.enabled and s.token_hash=extensions.digest(convert_to(p_token,'UTF8'),'sha256');
  if v_org is null then raise exception 'Station is not recognised' using errcode='42501'; end if;
  return query select m.user_id,coalesce(nullif(p.first_name,''),nullif(split_part(coalesce(p.display_name,''),' ',1),''),'Staff'),
    case when coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture') like 'https://%' and length(coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture'))<2048 then coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture') else null end
  from public.club_members m
  join public.club_station_staff_pins pin on pin.organisation_id=m.organisation_id and pin.user_id=m.user_id and pin.enabled
  left join public.profiles p on p.id=m.user_id left join auth.users u on u.id=m.user_id
  where m.organisation_id=v_org and m.active and m.role in ('owner','gym_admin','gym_staff','trainer')
  order by coalesce(nullif(p.first_name,''),split_part(coalesce(p.display_name,''),' ',1),'Staff');
end; $$;

create or replace function public.club_station_verify_pin(p_station_id uuid,p_token text,p_user_id uuid,p_pin text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare v_org uuid; v_pin public.club_station_staff_pins%rowtype; v_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'Station PIN verification is server-only' using errcode='42501'; end if;
  select s.organisation_id into v_org from public.club_shared_stations s where s.id=p_station_id and s.enabled and s.token_hash=extensions.digest(convert_to(p_token,'UTF8'),'sha256');
  if v_org is null or p_pin !~ '^[0-9]{4,6}$' then return null; end if;
  select * into v_pin from public.club_station_staff_pins where organisation_id=v_org and user_id=p_user_id for update;
  if not found then return null; end if;
  if not v_pin.enabled or (v_pin.locked_until is not null and v_pin.locked_until>now()) then return null; end if;
  if v_pin.locked_until is not null and v_pin.locked_until<=now() then
    update public.club_station_staff_pins set failed_attempts=0,locked_until=null where organisation_id=v_org and user_id=p_user_id;
    v_pin.failed_attempts:=0;
  end if;
  if not exists(select 1 from public.club_members where organisation_id=v_org and user_id=p_user_id and active and role in ('owner','gym_admin','gym_staff','trainer')) then return null; end if;
  if extensions.crypt(p_pin,v_pin.pin_hash)<>v_pin.pin_hash then
    v_count:=v_pin.failed_attempts+1;
    update public.club_station_staff_pins set failed_attempts=least(v_count,5),locked_until=case when v_count>=5 then now()+interval '5 minutes' else null end,updated_at=now() where organisation_id=v_org and user_id=p_user_id;
    return null;
  end if;
  update public.club_station_staff_pins set failed_attempts=0,locked_until=null,updated_at=now() where organisation_id=v_org and user_id=p_user_id;
  return (select jsonb_build_object('userId',u.id,'email',u.email) from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null);
end; $$;

revoke all on function public.club_station_set_my_pin(uuid,text),public.club_station_disable_my_pin(uuid),public.club_station_my_pin_status(uuid),public.club_register_shared_station(uuid,uuid,text,bytea),public.club_station_list_staff(uuid,text),public.club_station_verify_pin(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.club_station_set_my_pin(uuid,text),public.club_station_disable_my_pin(uuid),public.club_station_my_pin_status(uuid),public.club_register_shared_station(uuid,uuid,text,bytea) to authenticated;
grant execute on function public.club_station_list_staff(uuid,text),public.club_station_verify_pin(uuid,text,uuid,text) to service_role;
