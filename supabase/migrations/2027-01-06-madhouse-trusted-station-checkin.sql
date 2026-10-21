-- A scan's venue is resolved only from an authenticated registered station.
-- The existing kiosk/station cookie protocol is unchanged.
create or replace function public.club_shared_station_identity(p_station_id uuid,p_station_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare s public.club_shared_stations%rowtype; l public.club_locations%rowtype;
begin
  if auth.uid() is null or p_station_token is null then raise exception 'Station authentication required' using errcode='42501'; end if;
  select * into s from public.club_shared_stations x where x.id=p_station_id and x.enabled and x.token_hash=extensions.digest(convert_to(p_station_token,'UTF8'),'sha256');
  if not found or not public.club_capability_allowed(s.organisation_id,auth.uid(),'members.view') then raise exception 'Station is not trusted' using errcode='42501'; end if;
  select * into l from public.club_locations where id=s.location_id and organisation_id=s.organisation_id and active;
  if not found then raise exception 'Station location is unavailable' using errcode='55000'; end if;
  return jsonb_build_object('organisationId',s.organisation_id,'locationId',l.id,'locationName',l.name,'stationName',s.station_name);
end; $$;

create or replace function public.club_checkin_station_scan(p_station_id uuid,p_station_token text,p_credential text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,auth as $$
declare s public.club_shared_stations%rowtype; result jsonb; decision_id uuid; visit public.club_attendance_visits%rowtype; display_name text; is_new boolean:=false;
begin
  if auth.uid() is null or p_station_token is null or nullif(btrim(p_credential),'') is null then raise exception 'Station authentication and member QR are required' using errcode='42501'; end if;
  select * into s from public.club_shared_stations x where x.id=p_station_id and x.enabled and x.token_hash=extensions.digest(convert_to(p_station_token,'UTF8'),'sha256');
  if not found or not public.club_capability_allowed(s.organisation_id,auth.uid(),'members.view') then raise exception 'Station is not trusted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=s.location_id and organisation_id=s.organisation_id and active) then raise exception 'Station location is unavailable' using errcode='55000'; end if;
  result:=public.club_reception_access_decision(s.organisation_id,s.location_id,p_credential,'qr');
  decision_id:=nullif(result->>'auditReference','')::uuid;
  if decision_id is not null then
    update public.club_access_decisions set station_label=left(s.station_name,80) where id=decision_id and organisation_id=s.organisation_id;
    update public.club_attendance_visits set station_label=left(s.station_name,80) where access_decision_id=decision_id and organisation_id=s.organisation_id;
    select * into visit from public.club_attendance_visits where access_decision_id=decision_id and organisation_id=s.organisation_id;
    is_new:=found;
    if not is_new then select v.* into visit from public.club_access_decisions d join public.club_attendance_visits v on v.access_decision_id=d.bounce_of where d.id=decision_id and d.organisation_id=s.organisation_id; end if;
  end if;
  display_name:=nullif(btrim(result->'member'->>'displayName'),'');
  return jsonb_build_object('allowed',coalesce((result->>'allowed')::boolean,false),'decision',result->>'decision','reason',result->>'reason',
    'member',case when display_name is null then null else jsonb_build_object('displayName',split_part(display_name,' ',1)) end,
    'attendanceRecorded',is_new,'repeatVisit',coalesce((result->>'allowed')::boolean,false) and not is_new,
    'checkedAt',visit.checked_at,'stationLabel',s.station_name,'locationId',s.location_id);
end; $$;

-- Retire the old caller-selected location API. Do not leave an alternate path.
create or replace function public.club_checkin_station_scan(p_organisation_id uuid,p_location_id uuid,p_credential text,p_station_label text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin raise exception 'Registered station authentication is required' using errcode='42501'; end; $$;
revoke all on function public.club_shared_station_identity(uuid,text),public.club_checkin_station_scan(uuid,text,text),public.club_checkin_station_scan(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.club_shared_station_identity(uuid,text),public.club_checkin_station_scan(uuid,text,text) to authenticated;
