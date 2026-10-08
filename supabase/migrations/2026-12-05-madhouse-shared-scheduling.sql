-- Shared Madhouse staff schedule. Existing class sessions remain the booking
-- authority; PT sessions and staff blocks join them through one safe schedule API.
create table if not exists public.club_schedule_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  event_type text not null check (event_type in ('pt_session','unavailable','other_location','leave','admin_time')),
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  customer_id uuid,
  location_id uuid,
  external_location text,
  title text not null,
  internal_notes text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_schedule_event_valid_window check (ends_at > starts_at),
  constraint club_schedule_event_customer_org_fk foreign key (customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete set null (customer_id),
  constraint club_schedule_event_location_org_fk foreign key (location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict
);
create index if not exists club_schedule_events_staff_window_idx on public.club_schedule_events(organisation_id,staff_user_id,starts_at,ends_at) where status in ('scheduled','completed','no_show');
create index if not exists club_schedule_events_customer_window_idx on public.club_schedule_events(organisation_id,customer_id,starts_at) where event_type='pt_session' and status='scheduled';

-- Recurring local wall-clock availability is stored once per staff member/day;
-- it is not expanded into appointment rows.
create table if not exists public.club_staff_weekly_working_hours (
  organisation_id uuid not null,
  staff_user_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO Monday=1
  starts_at time not null,
  ends_at time not null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (organisation_id,staff_user_id,weekday),
  foreign key (organisation_id,staff_user_id) references public.club_members(organisation_id,user_id) on delete cascade,
  constraint club_staff_weekly_working_hours_window check (ends_at > starts_at)
);
create index if not exists club_staff_weekly_hours_lookup_idx on public.club_staff_weekly_working_hours(organisation_id,staff_user_id,weekday);
alter table public.club_staff_weekly_working_hours enable row level security;
revoke all on public.club_staff_weekly_working_hours from public,anon,authenticated;

-- Private PT clients are lightweight organisation-scoped people, not R12
-- accounts/customers. A future verified link can point to the canonical customer.
create table if not exists public.club_schedule_private_clients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  linked_customer_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,organisation_id),
  foreign key (linked_customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete set null (linked_customer_id)
);
create unique index if not exists club_schedule_private_client_customer_uq on public.club_schedule_private_clients(organisation_id,linked_customer_id) where linked_customer_id is not null;
create index if not exists club_schedule_private_clients_owner_idx on public.club_schedule_private_clients(organisation_id,created_by,display_name);
alter table public.club_schedule_private_clients enable row level security;
revoke all on public.club_schedule_private_clients from public,anon,authenticated;

alter table public.club_schedule_events
  add column if not exists private_client_id uuid,
  add column if not exists working_hours_override boolean not null default false,
  add column if not exists working_hours_override_by uuid references auth.users(id) on delete restrict,
  add column if not exists working_hours_override_reason text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='club_schedule_event_private_client_org_fk') then
    alter table public.club_schedule_events add constraint club_schedule_event_private_client_org_fk foreign key(private_client_id,organisation_id) references public.club_schedule_private_clients(id,organisation_id) on delete set null (private_client_id);
  end if;
  if not exists(select 1 from pg_constraint where conname='club_schedule_event_pt_client_xor_ck') then
    alter table public.club_schedule_events add constraint club_schedule_event_pt_client_xor_ck check (
      (event_type='pt_session' and ((customer_id is not null and private_client_id is null) or (customer_id is null and private_client_id is not null)))
      or (event_type<>'pt_session' and customer_id is null and private_client_id is null)
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='club_schedule_event_hours_override_ck') then
    alter table public.club_schedule_events add constraint club_schedule_event_hours_override_ck check (
      (working_hours_override and working_hours_override_by is not null and nullif(btrim(working_hours_override_reason),'') is not null)
      or (not working_hours_override and working_hours_override_by is null and working_hours_override_reason is null)
    );
  end if;
end $$;
create index if not exists club_schedule_events_private_client_idx on public.club_schedule_events(organisation_id,private_client_id,starts_at) where private_client_id is not null;
alter table public.club_schedule_events enable row level security;
revoke all on public.club_schedule_events from public,anon,authenticated;
alter table public.club_member_notification_intents
  add column if not exists in_app_visible boolean not null default false,
  add column if not exists seen_at timestamptz;
create index if not exists club_member_schedule_notifications_idx on public.club_member_notification_intents(user_id,created_at desc) where in_app_visible and template_key='schedule_update';

-- Serialize each staff member's schedule before checking both schedule events
-- and the established class-session table. This closes concurrent double-booking.
create or replace function public.club_assert_schedule_available(p_organisation_id uuid,p_staff_user_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_ignore_event_id uuid default null,p_ignore_class_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_staff_user_id::text,0));
  if exists(select 1 from public.club_schedule_events e where e.organisation_id=p_organisation_id and e.staff_user_id=p_staff_user_id and e.id is distinct from p_ignore_event_id and e.status='scheduled' and e.starts_at<p_ends_at and e.ends_at>p_starts_at)
     or exists(select 1 from public.club_class_sessions c where c.organisation_id=p_organisation_id and c.host_user_id=p_staff_user_id and c.id is distinct from p_ignore_class_id and c.status='scheduled' and c.starts_at<p_ends_at and c.ends_at>p_starts_at) then
    raise exception 'This staff member already has a calendar item during that time.' using errcode='23P01';
  end if;
end; $$;
revoke all on function public.club_assert_schedule_available(uuid,uuid,timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;

create or replace function public.club_check_class_schedule_conflict()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='scheduled' and new.host_user_id is not null then
    perform public.club_assert_schedule_available(new.organisation_id,new.host_user_id,new.starts_at,new.ends_at,null,new.id);
  end if;
  return new;
end; $$;
create or replace function public.club_lock_schedule_staff_changes()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare first_id uuid; second_id uuid; old_staff uuid; new_staff uuid;
begin
  if tg_op='UPDATE' then
    if tg_table_name='club_class_sessions' then old_staff:=old.host_user_id;new_staff:=new.host_user_id;
    else old_staff:=old.staff_user_id;new_staff:=new.staff_user_id; end if;
  end if;
  if tg_op='UPDATE' and old_staff is distinct from new_staff and old_staff is not null and new_staff is not null then
    first_id:=least(old_staff,new_staff);second_id:=greatest(old_staff,new_staff);
    perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text||':'||first_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text||':'||second_id::text,0));
  end if;
  return new;
end; $$;
drop trigger if exists club_schedule_staff_change_lock on public.club_schedule_events;
create trigger club_schedule_staff_change_lock before update of staff_user_id on public.club_schedule_events for each row execute function public.club_lock_schedule_staff_changes();
drop trigger if exists club_class_staff_change_lock on public.club_class_sessions;
drop trigger if exists club_class_00_staff_change_lock on public.club_class_sessions;
create trigger club_class_00_staff_change_lock before update of host_user_id on public.club_class_sessions for each row execute function public.club_lock_schedule_staff_changes();
drop trigger if exists club_class_schedule_conflict on public.club_class_sessions;
create trigger club_class_10_schedule_conflict before insert or update of organisation_id,host_user_id,starts_at,ends_at,status on public.club_class_sessions for each row execute function public.club_check_class_schedule_conflict();

create or replace function public.club_save_schedule_event(p_id uuid,p_organisation_id uuid,p_event_type text,p_staff_user_id uuid,p_customer_id uuid,p_private_client_id uuid,p_location_id uuid,p_external_location text,p_title text,p_internal_notes text,p_starts_at timestamptz,p_ends_at timestamptz,p_status text,p_working_hours_override boolean default false,p_working_hours_override_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare existing public.club_schedule_events%rowtype; result public.club_schedule_events%rowtype; broad boolean; self_trainer boolean; manager_override boolean; outside_hours boolean:=false; actor_role text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  broad:=public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') and public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']);
  self_trainer:=public.club_has_active_role(p_organisation_id,array['trainer']) and p_staff_user_id=auth.uid();
  if not broad and not self_trainer then raise exception 'Schedule management is not permitted' using errcode='42501'; end if;
  if p_event_type not in ('pt_session','unavailable','other_location','leave','admin_time') or p_status not in ('scheduled','completed','cancelled','no_show') or p_ends_at<=p_starts_at or nullif(btrim(p_title),'') is null then raise exception 'Invalid schedule item' using errcode='22023'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_staff_user_id and active and role in ('trainer','gym_admin','owner')) then raise exception 'Schedule assignee is not active PT staff in this organisation' using errcode='22023'; end if;
  if p_id is not null then
    select * into existing from public.club_schedule_events where id=p_id and organisation_id=p_organisation_id for update;
    if not found then raise exception 'Schedule item not found' using errcode='P0002'; end if;
    if not broad and existing.staff_user_id<>auth.uid() then raise exception 'You can only manage your own schedule' using errcode='42501'; end if;
  end if;
  if p_event_type='pt_session' and ((p_customer_id is null) = (p_private_client_id is null) or p_location_id is null) then raise exception 'Choose exactly one member or private client, and a location' using errcode='22023'; end if;
  if p_event_type<>'pt_session' and (p_customer_id is not null or p_private_client_id is not null) then raise exception 'Only PT sessions can be linked to a client' using errcode='22023'; end if;
  if p_event_type='other_location' and p_location_id is null and nullif(btrim(p_external_location),'') is null then raise exception 'Add the other location name' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Member is outside this organisation' using errcode='22023'; end if;
  if p_private_client_id is not null and not exists(select 1 from public.club_schedule_private_clients pc where pc.id=p_private_client_id and pc.organisation_id=p_organisation_id and (broad or pc.created_by=auth.uid() or (p_id is not null and existing.private_client_id=pc.id and existing.staff_user_id=auth.uid()))) then raise exception 'Private client is not available to this Coach' using errcode='42501'; end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Location is unavailable' using errcode='22023'; end if;
  if p_event_type='pt_session' and p_status='scheduled' then
    perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_staff_user_id::text,0));
    select not exists(select 1 from public.club_staff_weekly_working_hours h where h.organisation_id=p_organisation_id and h.staff_user_id=p_staff_user_id and h.weekday=extract(isodow from (p_starts_at at time zone 'Europe/London'))::smallint and h.starts_at<=(p_starts_at at time zone 'Europe/London')::time and h.ends_at>=(p_ends_at at time zone 'Europe/London')::time and (p_starts_at at time zone 'Europe/London')::date=(p_ends_at at time zone 'Europe/London')::date) into outside_hours;
    if outside_hours then
      manager_override:=p_working_hours_override is true and public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) and public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage');
      if not manager_override or nullif(btrim(p_working_hours_override_reason),'') is null then raise exception 'This PT appointment falls outside the coach’s normal working hours. Choose an in-hours time or request an authorised override.' using errcode='22023'; end if;
      select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
    elsif coalesce(p_working_hours_override,false) then
      raise exception 'An hours override is only available when the appointment is outside normal working hours.' using errcode='22023';
    end if;
  elsif coalesce(p_working_hours_override,false) then
    raise exception 'Working-hours overrides only apply to PT appointments.' using errcode='22023';
  end if;
  if p_status='scheduled' then perform public.club_assert_schedule_available(p_organisation_id,p_staff_user_id,p_starts_at,p_ends_at,p_id,null); end if;
  if p_id is null then
    insert into public.club_schedule_events(organisation_id,event_type,staff_user_id,customer_id,private_client_id,location_id,external_location,title,internal_notes,starts_at,ends_at,status,created_by,updated_by,working_hours_override,working_hours_override_by,working_hours_override_reason)
    values(p_organisation_id,p_event_type,p_staff_user_id,p_customer_id,p_private_client_id,p_location_id,nullif(btrim(p_external_location),''),btrim(p_title),nullif(btrim(p_internal_notes),''),p_starts_at,p_ends_at,p_status,auth.uid(),auth.uid(),manager_override is true,case when manager_override then auth.uid() end,case when manager_override then btrim(p_working_hours_override_reason) end) returning * into result;
  else
    update public.club_schedule_events set event_type=p_event_type,staff_user_id=p_staff_user_id,customer_id=p_customer_id,private_client_id=p_private_client_id,location_id=p_location_id,external_location=nullif(btrim(p_external_location),''),title=btrim(p_title),internal_notes=case when existing.staff_user_id=auth.uid() or public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then nullif(btrim(p_internal_notes),'') else internal_notes end,starts_at=p_starts_at,ends_at=p_ends_at,status=p_status,updated_by=auth.uid(),updated_at=now(),working_hours_override=manager_override is true,working_hours_override_by=case when manager_override then auth.uid() end,working_hours_override_reason=case when manager_override then btrim(p_working_hours_override_reason) end where id=p_id returning * into result;
  end if;
  if manager_override then insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.working_hours_override','schedule_event',result.id,jsonb_build_object('staff_user_id',p_staff_user_id,'starts_at',p_starts_at,'ends_at',p_ends_at,'reason',btrim(p_working_hours_override_reason))); end if;
  if result.event_type='pt_session' and result.customer_id is not null and (p_id is null or existing.title is distinct from result.title or existing.starts_at is distinct from result.starts_at or existing.ends_at is distinct from result.ends_at or existing.location_id is distinct from result.location_id or existing.staff_user_id is distinct from result.staff_user_id or existing.status is distinct from result.status) then
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id,in_app_visible)
    select p_organisation_id,c.user_id,u.email,'member_service','schedule_update','pending','schedule:'||result.id||':'||result.updated_at::text,now(),'members',jsonb_build_object('eventType',case when p_id is null then 'booked' when result.status='cancelled' then 'cancelled' else 'updated' end,'kind','PT session','title',result.title,'startsAt',result.starts_at,'endsAt',result.ends_at,'location',(select name from public.club_locations where id=result.location_id),'organisationName',(select name from public.club_organisations where id=p_organisation_id)),'schedule_event',result.id,true
    from public.club_customers c join auth.users u on u.id=c.user_id where c.id=result.customer_id and c.organisation_id=p_organisation_id and c.user_id is not null
    on conflict(organisation_id,idempotency_key) do nothing;
  end if;
  return jsonb_build_object('id',result.id,'event_type',result.event_type,'staff_user_id',result.staff_user_id,'customer_id',result.customer_id,'location_id',result.location_id,'external_location',result.external_location,'title',result.title,'internal_notes',case when public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or result.staff_user_id=auth.uid() then result.internal_notes else null end,'starts_at',result.starts_at,'ends_at',result.ends_at,'status',result.status,'updated_at',result.updated_at);
end; $$;
revoke all on function public.club_save_schedule_event(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,boolean,text) from public,anon;
grant execute on function public.club_save_schedule_event(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,boolean,text) to authenticated;

create or replace function public.club_list_shared_schedule(p_organisation_id uuid,p_from timestamptz,p_to timestamptz,p_staff_user_id uuid default null,p_location_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare can_view boolean:=public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage'); can_notes boolean:=public.club_has_active_role(p_organisation_id,array['gym_admin','owner']);
begin
  if auth.uid() is null or not can_view then raise exception 'Schedule access is not permitted' using errcode='42501'; end if;
  if p_to<=p_from or p_to-p_from>interval '62 days' then raise exception 'Invalid schedule window' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(x.item order by x.starts_at) from (
    select jsonb_build_object(
      'id',e.id,'eventType',e.event_type,'staffUserId',e.staff_user_id,
      'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'PT'),
      'customerId',case when e.private_client_id is null or can_notes or e.staff_user_id=auth.uid() then e.customer_id end,
      'privateClientId',case when e.private_client_id is null or can_notes or e.staff_user_id=auth.uid() then e.private_client_id end,
      'memberName',case when e.private_client_id is not null then case when can_notes or e.staff_user_id=auth.uid() then pc.display_name end else c.display_name end,
      'locationId',e.location_id,'locationName',l.name,'externalLocation',e.external_location,
      'title',case when e.private_client_id is not null and not (can_notes or e.staff_user_id=auth.uid()) then 'PT session' else e.title end,
      'notes',case when can_notes or e.staff_user_id=auth.uid() then e.internal_notes end,
      'workingHoursOverride',e.working_hours_override,'startsAt',e.starts_at,'endsAt',e.ends_at,'status',e.status
    ) item,e.starts_at
    from public.club_schedule_events e
    join public.club_members m on m.organisation_id=e.organisation_id and m.user_id=e.staff_user_id and m.active
    left join public.profiles p on p.id=e.staff_user_id
    left join public.club_customers c on c.id=e.customer_id and c.organisation_id=e.organisation_id
    left join public.club_schedule_private_clients pc on pc.id=e.private_client_id and pc.organisation_id=e.organisation_id
    left join public.club_locations l on l.id=e.location_id and l.organisation_id=e.organisation_id
    where e.organisation_id=p_organisation_id and e.starts_at<p_to and e.ends_at>p_from and (p_staff_user_id is null or e.staff_user_id=p_staff_user_id) and (p_location_id is null or e.location_id=p_location_id)
    union all
    select jsonb_build_object('id',s.id,'eventType','class','staffUserId',s.host_user_id,'staffName',coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),'Instructor'),'customerId',null,'memberName',null,'locationId',s.location_id,'locationName',l.name,'externalLocation',null,'title',coalesce(s.title,t.name),'description',t.description,'capacity',s.capacity,'notes',null,'startsAt',s.starts_at,'endsAt',s.ends_at,'status',s.status) item,s.starts_at from public.club_class_sessions s left join public.profiles p on p.id=s.host_user_id left join public.club_locations l on l.id=s.location_id and l.organisation_id=s.organisation_id left join public.club_class_types t on t.id=s.class_type_id and t.organisation_id=s.organisation_id where s.organisation_id=p_organisation_id and s.starts_at<p_to and s.ends_at>p_from and (p_staff_user_id is null or s.host_user_id=p_staff_user_id) and (p_location_id is null or s.location_id=p_location_id)
  ) x),'[]'::jsonb);
end; $$;
revoke all on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) to authenticated;

-- Member-safe projection: only their own scheduled PT sessions and confirmed classes;
-- no internal notes and no other member identities are ever selected.
create or replace function public.club_list_my_schedule(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(x.item order by x.starts_at),'[]'::jsonb) from (
 select jsonb_build_object('id',e.id,'eventType','pt_session','title',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,'status',e.status,'staffName',p.display_name,'locationName',l.name) item,e.starts_at
 from public.club_schedule_events e join public.club_customers c on c.id=e.customer_id and c.organisation_id=e.organisation_id and c.user_id=auth.uid() left join public.profiles p on p.id=e.staff_user_id left join public.club_locations l on l.id=e.location_id and l.organisation_id=e.organisation_id where e.organisation_id=p_organisation_id and e.event_type='pt_session' and e.status='scheduled' and e.starts_at>=now()
 union all
 select jsonb_build_object('id',s.id,'eventType','class','title',coalesce(s.title,t.name),'startsAt',s.starts_at,'endsAt',s.ends_at,'status',s.status,'staffName',p.display_name,'locationName',l.name) item,s.starts_at
 from public.club_class_bookings b join public.club_class_sessions s on s.id=b.session_id and s.organisation_id=b.organisation_id join public.club_customers c on c.id=b.customer_id and c.organisation_id=b.organisation_id and c.user_id=auth.uid() left join public.profiles p on p.id=s.host_user_id left join public.club_locations l on l.id=s.location_id and l.organisation_id=s.organisation_id left join public.club_class_types t on t.id=s.class_type_id and t.organisation_id=s.organisation_id where b.organisation_id=p_organisation_id and b.status='confirmed' and s.status='scheduled' and s.starts_at>=now()
) x where auth.uid() is not null and public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']);
$$;
revoke all on function public.club_list_my_schedule(uuid) from public,anon;
grant execute on function public.club_list_my_schedule(uuid) to authenticated;

create or replace function public.club_list_schedule_staff(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'PT')) order by p.first_name,p.last_name),'[]'::jsonb)
from public.club_members m left join public.profiles p on p.id=m.user_id
where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_admin','owner')
and auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage');
$$;
revoke all on function public.club_list_schedule_staff(uuid) from public,anon;
grant execute on function public.club_list_schedule_staff(uuid) to authenticated;

create or replace function public.club_list_shared_working_hours(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('staffUserId',h.staff_user_id,'weekday',h.weekday,'startsAt',to_char(h.starts_at,'HH24:MI'),'endsAt',to_char(h.ends_at,'HH24:MI')) order by h.staff_user_id,h.weekday),'[]'::jsonb)
from public.club_staff_weekly_working_hours h
where h.organisation_id=p_organisation_id and auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage');
$$;
revoke all on function public.club_list_shared_working_hours(uuid) from public,anon;
grant execute on function public.club_list_shared_working_hours(uuid) to authenticated;

create or replace function public.club_save_staff_weekly_working_hours(p_organisation_id uuid,p_staff_user_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare manager boolean; own_trainer boolean; item jsonb; v_day smallint; v_start time; v_end time; seen_days smallint[]:='{}'; saved jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>7 then raise exception 'Invalid weekly hours' using errcode='22023'; end if;
  manager:=public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') and public.club_has_active_role(p_organisation_id,array['gym_admin','owner']);
  own_trainer:=public.club_has_active_role(p_organisation_id,array['trainer']) and p_staff_user_id=auth.uid();
  if not (manager or own_trainer) then raise exception 'You may only update your own working hours, unless you are an authorised manager.' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_staff_user_id and active and role in ('trainer','gym_admin','owner')) then raise exception 'Coach is not active in this organisation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_staff_user_id::text,0));
  for item in select value from jsonb_array_elements(p_rows) loop
    if nullif(item->>'weekday','') is null or item->>'weekday' !~ '^[1-7]$' or coalesce(item->>'startsAt','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(item->>'endsAt','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Each working day needs a valid UK start and end time.' using errcode='22023'; end if;
    v_day:=(item->>'weekday')::smallint;v_start:=(item->>'startsAt')::time;v_end:=(item->>'endsAt')::time;
    if v_day=any(seen_days) or v_end<=v_start then raise exception 'Choose one valid time range for each working day.' using errcode='22023'; end if;
    seen_days:=array_append(seen_days,v_day);
  end loop;
  delete from public.club_staff_weekly_working_hours where organisation_id=p_organisation_id and staff_user_id=p_staff_user_id;
  for item in select value from jsonb_array_elements(p_rows) loop
    v_day:=(item->>'weekday')::smallint;v_start:=(item->>'startsAt')::time;v_end:=(item->>'endsAt')::time;
    insert into public.club_staff_weekly_working_hours(organisation_id,staff_user_id,weekday,starts_at,ends_at,updated_by) values(p_organisation_id,p_staff_user_id,v_day,v_start,v_end,auth.uid());
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startsAt',to_char(starts_at,'HH24:MI'),'endsAt',to_char(ends_at,'HH24:MI')) order by weekday),'[]'::jsonb) into saved from public.club_staff_weekly_working_hours where organisation_id=p_organisation_id and staff_user_id=p_staff_user_id;
  return saved;
end; $$;
revoke all on function public.club_save_staff_weekly_working_hours(uuid,uuid,jsonb) from public,anon;
grant execute on function public.club_save_staff_weekly_working_hours(uuid,uuid,jsonb) to authenticated;

create or replace function public.club_create_schedule_private_client(p_organisation_id uuid,p_display_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.club_schedule_private_clients%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view') or not public.club_has_active_role(p_organisation_id,array['trainer','gym_staff','gym_admin','owner']) then raise exception 'Private PT client creation is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_display_name),'') is null or length(btrim(p_display_name))>120 then raise exception 'Enter a client name up to 120 characters.' using errcode='22023'; end if;
  insert into public.club_schedule_private_clients(organisation_id,display_name,created_by) values(p_organisation_id,btrim(p_display_name),auth.uid()) returning * into result;
  return jsonb_build_object('id',result.id,'name',result.display_name);
end; $$;
revoke all on function public.club_create_schedule_private_client(uuid,text) from public,anon;
grant execute on function public.club_create_schedule_private_client(uuid,text) to authenticated;

create or replace function public.club_search_schedule_private_clients(p_organisation_id uuid,p_query text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',pc.id,'name',pc.display_name) order by pc.display_name),'[]'::jsonb)
from public.club_schedule_private_clients pc
where pc.organisation_id=p_organisation_id and nullif(btrim(p_query),'') is not null and pc.display_name ilike '%'||left(btrim(p_query),80)||'%'
  and auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view')
  and (public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or pc.created_by=auth.uid() or exists(select 1 from public.club_schedule_events e where e.organisation_id=pc.organisation_id and e.private_client_id=pc.id and e.staff_user_id=auth.uid()));
$$;
revoke all on function public.club_search_schedule_private_clients(uuid,text) from public,anon;
grant execute on function public.club_search_schedule_private_clients(uuid,text) to authenticated;

create or replace function public.club_search_schedule_members(p_organisation_id uuid,p_query text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name) order by c.display_name),'[]'::jsonb)
from (select id,display_name from public.club_customers where organisation_id=p_organisation_id and (user_id is not null or status='member') and nullif(btrim(p_query),'') is not null and display_name ilike '%'||left(btrim(p_query),80)||'%' order by display_name limit 12) c
where auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'members.view');
$$;
revoke all on function public.club_search_schedule_members(uuid,text) from public,anon;
grant execute on function public.club_search_schedule_members(uuid,text) to authenticated;

-- Class bookings already express the member's class association. Feed class
-- booking/schedule changes into the same member notification outbox idempotently.
create or replace function public.club_queue_schedule_class_notice()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_class_sessions%rowtype; c public.club_customers%rowtype; u record; notice_type text; key text;
begin
  if tg_table_name='club_class_bookings' then
    if tg_op='INSERT' and new.status<>'confirmed' then return new; end if;
    if tg_op='UPDATE' and not (old.status='confirmed' and new.status='cancelled') then return new; end if;
    select * into s from public.club_class_sessions where id=new.session_id and organisation_id=new.organisation_id;
    select * into c from public.club_customers where id=new.customer_id and organisation_id=new.organisation_id;
    if c.user_id is null then return new; end if;
    select email into u from auth.users where id=c.user_id;
    notice_type:=case when new.status='cancelled' then 'cancelled' else 'booked' end;key:='schedule-class-booking:'||new.id||':'||new.status;
  else
    if tg_op<>'UPDATE' or old.status='cancelled' and new.status='cancelled' or (old.starts_at is not distinct from new.starts_at and old.ends_at is not distinct from new.ends_at and old.title is not distinct from new.title and old.location_id is not distinct from new.location_id and old.host_user_id is not distinct from new.host_user_id and old.status is not distinct from new.status) then return new; end if;
    s:=new;
    notice_type:=case when new.status='cancelled' then 'cancelled' else 'updated' end;
    key:='schedule-class:'||new.id||':'||extract(epoch from new.updated_at)::bigint::text;
    for c in select customer.* from public.club_class_bookings b join public.club_customers customer on customer.id=b.customer_id and customer.organisation_id=b.organisation_id where b.organisation_id=new.organisation_id and b.session_id=new.id and b.status='confirmed' and customer.user_id is not null loop
      select email into u from auth.users where id=c.user_id;
      insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id,in_app_visible)
      values(new.organisation_id,c.user_id,u.email,'member_service','schedule_update','pending',key||':'||c.user_id,now(),'members',jsonb_build_object('eventType',notice_type,'kind','class','title',coalesce(new.title,(select name from public.club_class_types where id=new.class_type_id)),'startsAt',new.starts_at,'location',(select name from public.club_locations where id=new.location_id),'organisationName',(select name from public.club_organisations where id=new.organisation_id)),'class_session',new.id,true) on conflict(organisation_id,idempotency_key) do nothing;
    end loop;
    return new;
  end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id,in_app_visible)
  values(new.organisation_id,c.user_id,u.email,'member_service','schedule_update','pending',key,now(),'members',jsonb_build_object('eventType',notice_type,'kind','class','title',coalesce(s.title,(select name from public.club_class_types where id=s.class_type_id)),'startsAt',s.starts_at,'location',(select name from public.club_locations where id=s.location_id),'organisationName',(select name from public.club_organisations where id=new.organisation_id)),'class_booking',new.id,true) on conflict(organisation_id,idempotency_key) do nothing;
  return new;
end; $$;
drop trigger if exists club_class_booking_schedule_notice on public.club_class_bookings;
create trigger club_class_booking_schedule_notice after insert or update of status on public.club_class_bookings for each row execute function public.club_queue_schedule_class_notice();
drop trigger if exists club_class_session_schedule_notice on public.club_class_sessions;
create trigger club_class_session_schedule_notice after update of title,starts_at,ends_at,location_id,host_user_id,status on public.club_class_sessions for each row execute function public.club_queue_schedule_class_notice();

create or replace function public.club_list_my_schedule_notifications(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'action',n.payload->>'eventType','kind',n.payload->>'kind','title',n.payload->>'title','startsAt',n.payload->>'startsAt','location',n.payload->>'location','createdAt',n.created_at,'seenAt',n.seen_at) order by n.created_at desc),'[]'::jsonb)
from public.club_member_notification_intents n
where n.organisation_id=p_organisation_id and n.user_id=auth.uid() and n.in_app_visible and n.template_key='schedule_update'
  and auth.uid() is not null and public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']);
$$;
revoke all on function public.club_list_my_schedule_notifications(uuid) from public,anon;
grant execute on function public.club_list_my_schedule_notifications(uuid) to authenticated;

create or replace function public.club_mark_my_schedule_notification_seen(p_organisation_id uuid,p_notification_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  update public.club_member_notification_intents set seen_at=coalesce(seen_at,now()),updated_at=now()
  where id=p_notification_id and organisation_id=p_organisation_id and user_id=auth.uid() and in_app_visible and template_key='schedule_update';
end; $$;
revoke all on function public.club_mark_my_schedule_notification_seen(uuid,uuid) from public,anon;
grant execute on function public.club_mark_my_schedule_notification_seen(uuid,uuid) to authenticated;

comment on table public.club_schedule_events is 'Madhouse PT appointments and staff time blocks. Existing club_class_sessions remain linked through the shared calendar API and class booking authority.';
comment on column public.club_schedule_events.internal_notes is 'Staff-only notes. Never included by the member schedule RPC.';
