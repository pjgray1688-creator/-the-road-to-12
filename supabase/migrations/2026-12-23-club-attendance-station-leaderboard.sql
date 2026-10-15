-- Canonical attendance visits are derived only from an allowed access decision
-- explicitly marked attendance_recorded. A home gym never participates here.
alter table public.club_access_decisions
  add column if not exists station_label text;

-- No existing Club setting controls repeat-arrival grouping; keep the launch
-- rule isolated here so it can later become organisation-configurable.
create or replace function public.club_attendance_repeat_window()
returns interval language sql immutable set search_path=pg_catalog as $$ select interval '2 hours' $$;
revoke all on function public.club_attendance_repeat_window() from public,anon,authenticated;

create table if not exists public.club_attendance_visits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null,
  customer_id uuid not null,
  membership_id uuid,
  device_id uuid references public.club_access_devices(id) on delete set null,
  access_decision_id uuid not null unique references public.club_access_decisions(id) on delete cascade,
  checked_at timestamptz not null,
  method text not null,
  source text not null check(source in ('reception','device')),
  station_label text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  foreign key (customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict,
  foreign key (membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete set null (membership_id)
);
create index if not exists club_attendance_monthly_idx
  on public.club_attendance_visits(organisation_id,checked_at desc,location_id,customer_id);
create index if not exists club_attendance_repeat_scan_idx
  on public.club_attendance_visits(organisation_id,location_id,customer_id,checked_at desc);
alter table public.club_attendance_visits enable row level security;
revoke all on public.club_attendance_visits from public,anon,authenticated;

-- Keep historical successful arrivals as the same canonical event stream.
insert into public.club_attendance_visits(organisation_id,location_id,customer_id,membership_id,device_id,access_decision_id,checked_at,method,source,station_label,actor_user_id)
select d.organisation_id,d.location_id,d.customer_id,d.membership_id,d.device_id,d.id,d.decided_at,d.credential_type,d.source,d.station_label,d.actor_user_id
from public.club_access_decisions d
where d.decision='allow' and d.attendance_recorded and d.customer_id is not null
  and not exists (
    select 1 from public.club_access_decisions prior
    where prior.organisation_id=d.organisation_id and prior.location_id=d.location_id
      and prior.customer_id=d.customer_id and prior.decision='allow'
      and prior.attendance_recorded and prior.decided_at>d.decided_at-public.club_attendance_repeat_window()
      and prior.decided_at<d.decided_at
  )
on conflict(access_decision_id) do nothing;

create or replace function public.club_attendance_dedupe_decision()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior_decision uuid;
begin
  if new.decision<>'allow' or not new.attendance_recorded or new.customer_id is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.organisation_id::text||':'||new.location_id::text||':'||new.customer_id::text,0));
  select access_decision_id into prior_decision
  from public.club_attendance_visits
  where organisation_id=new.organisation_id and location_id=new.location_id
    and customer_id=new.customer_id and checked_at>new.decided_at-public.club_attendance_repeat_window()
    and checked_at<=new.decided_at
  order by checked_at desc limit 1;
  if prior_decision is not null then
    new.attendance_recorded:=false;
    new.bounce_of:=coalesce(new.bounce_of,prior_decision);
  end if;
  return new;
end; $$;
revoke all on function public.club_attendance_dedupe_decision() from public,anon,authenticated;
drop trigger if exists club_attendance_dedupe_decision on public.club_access_decisions;
create trigger club_attendance_dedupe_decision
before insert on public.club_access_decisions
for each row execute function public.club_attendance_dedupe_decision();

create or replace function public.club_attendance_record_decision()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.decision='allow' and new.attendance_recorded and new.customer_id is not null then
    insert into public.club_attendance_visits(organisation_id,location_id,customer_id,membership_id,device_id,access_decision_id,checked_at,method,source,station_label,actor_user_id)
    values(new.organisation_id,new.location_id,new.customer_id,new.membership_id,new.device_id,new.id,new.decided_at,new.credential_type,new.source,new.station_label,new.actor_user_id)
    on conflict(access_decision_id) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.club_attendance_record_decision() from public,anon,authenticated;
drop trigger if exists club_attendance_record_decision on public.club_access_decisions;
create trigger club_attendance_record_decision
after insert on public.club_access_decisions
for each row execute function public.club_attendance_record_decision();

create or replace function public.club_checkin_station_scan(
  p_organisation_id uuid,p_location_id uuid,p_credential text,p_station_label text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; decision_id uuid; visit public.club_attendance_visits%rowtype; resolved_label text; display_name text; new_visit boolean:=false;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') then
    raise exception 'Check-in station access is not permitted' using errcode='42501';
  end if;
  resolved_label:=left(nullif(btrim(p_station_label),''),80);
  if resolved_label is null or nullif(btrim(p_credential),'') is null then
    raise exception 'Station name and QR token are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then
    raise exception 'Selected venue is unavailable' using errcode='22023';
  end if;
  result:=public.club_reception_access_decision(p_organisation_id,p_location_id,p_credential,'qr');
  decision_id:=nullif(result->>'auditReference','')::uuid;
  if decision_id is not null then
    update public.club_access_decisions set station_label=resolved_label
      where id=decision_id and organisation_id=p_organisation_id;
    update public.club_attendance_visits set station_label=resolved_label
      where access_decision_id=decision_id and organisation_id=p_organisation_id;
    select * into visit from public.club_attendance_visits
      where access_decision_id=decision_id and organisation_id=p_organisation_id;
    new_visit:=found;
    if not new_visit then
      select v.* into visit
      from public.club_access_decisions bounced
      join public.club_attendance_visits v on v.access_decision_id=bounced.bounce_of
      where bounced.id=decision_id and bounced.organisation_id=p_organisation_id
        and v.organisation_id=p_organisation_id;
    end if;
  end if;
  display_name:=nullif(btrim(result->'member'->>'displayName'),'');
  return jsonb_build_object(
    'allowed',coalesce((result->>'allowed')::boolean,false),
    'decision',result->>'decision',
    'reason',result->>'reason',
    'member',case when display_name is null then null else jsonb_build_object('displayName',split_part(display_name,' ',1)) end,
    'attendanceRecorded',new_visit,
    'repeatVisit',coalesce((result->>'allowed')::boolean,false) and not new_visit,
    'checkedAt',visit.checked_at,
    'stationLabel',resolved_label
  );
end; $$;

create or replace function public.club_monthly_attendance_leaderboard(p_organisation_id uuid,p_location_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare month_start timestamptz; month_end timestamptz; result jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active
  ) then raise exception 'Member attendance access is not permitted' using errcode='42501'; end if;
  if p_location_id is not null and not exists(
    select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active
  ) then raise exception 'Selected venue is unavailable' using errcode='22023'; end if;
  month_start:=date_trunc('month',now() at time zone 'Europe/London') at time zone 'Europe/London';
  month_end:=(date_trunc('month',now() at time zone 'Europe/London')+interval '1 month') at time zone 'Europe/London';
  with counts as (
    select v.customer_id,c.display_name,count(*)::integer as visits
    from public.club_attendance_visits v
    join public.club_customers c on c.id=v.customer_id and c.organisation_id=v.organisation_id
    join public.club_members m on m.organisation_id=c.organisation_id and m.user_id=c.user_id and m.active and m.role='member'
    where v.organisation_id=p_organisation_id and v.checked_at>=month_start and v.checked_at<month_end
      and (p_location_id is null or v.location_id=p_location_id)
    group by v.customer_id,c.display_name
  ), ranked as (
    select dense_rank() over(order by visits desc) as rank,customer_id,
      case when position(' ' in btrim(display_name))>0
        then split_part(btrim(display_name),' ',1)||' '||left(regexp_replace(btrim(display_name),'^.*\s',''),1)||'.'
        else btrim(display_name) end as display_name,visits
    from counts
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank',rank,'displayName',display_name,'visits',visits)
    order by rank,display_name,customer_id),'[]'::jsonb) into result from ranked;
  return result;
end; $$;

revoke all on function public.club_checkin_station_scan(uuid,uuid,text,text),public.club_monthly_attendance_leaderboard(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_checkin_station_scan(uuid,uuid,text,text),public.club_monthly_attendance_leaderboard(uuid,uuid) to authenticated;
