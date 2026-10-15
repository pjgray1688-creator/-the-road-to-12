-- PIN setup/reset is password-verified by the authenticated server route.
-- These mutation RPCs are callable only with the service role; the route first
-- verifies the current cookie identity and that identity's password through
-- Supabase Auth in a non-persistent client.
create or replace function public.club_station_set_pin_after_password(
  p_organisation_id uuid,
  p_user_id uuid,
  p_pin text
) returns void
language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare v_role text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Station PIN setup is server-only' using errcode='42501';
  end if;
  if p_user_id is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must contain 4 to 6 digits' using errcode='22023';
  end if;
  select m.role into v_role from public.club_members m
  where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active
    and m.role in ('owner','gym_admin','gym_staff','trainer');
  if v_role is null then raise exception 'Active Club staff access required' using errcode='42501'; end if;

  insert into public.club_station_staff_pins(organisation_id,user_id,pin_hash,failed_attempts,locked_until,enabled,updated_at)
  values(p_organisation_id,p_user_id,extensions.crypt(p_pin,extensions.gen_salt('bf',12)),0,null,true,now())
  on conflict(organisation_id,user_id) do update
    set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,enabled=true,updated_at=now();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(p_organisation_id,p_user_id,v_role,'staff.station_pin_set','staff',p_user_id,'{}'::jsonb);
end; $$;

create or replace function public.club_station_disable_pin_after_password(
  p_organisation_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare v_role text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Station PIN setup is server-only' using errcode='42501';
  end if;
  select m.role into v_role from public.club_members m
  where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active
    and m.role in ('owner','gym_admin','gym_staff','trainer');
  if v_role is null then raise exception 'Active Club staff access required' using errcode='42501'; end if;
  update public.club_station_staff_pins
  set enabled=false,failed_attempts=0,locked_until=null,updated_at=now()
  where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(p_organisation_id,p_user_id,v_role,'staff.station_pin_disabled','staff',p_user_id,'{}'::jsonb);
end; $$;

revoke all on function public.club_station_set_pin_after_password(uuid,uuid,text),
  public.club_station_disable_pin_after_password(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_station_set_pin_after_password(uuid,uuid,text),
  public.club_station_disable_pin_after_password(uuid,uuid) to service_role;
