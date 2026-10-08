-- Separate staffed gym rota, PT diary availability, appointments and leave.
-- This is additive to the live 2026-12-05 schedule migration.

create table if not exists public.club_staff_rota_shifts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  staff_user_id uuid not null,
  work_date date not null,
  starts_at time not null,
  ends_at time not null,
  location_id uuid not null,
  note text,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_staff_rota_shift_window check (ends_at > starts_at),
  foreign key (organisation_id,staff_user_id) references public.club_members(organisation_id,user_id) on delete restrict,
  foreign key (location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  unique (id,organisation_id)
);
create index if not exists club_staff_rota_lookup_idx on public.club_staff_rota_shifts(organisation_id,work_date,location_id,staff_user_id) where status='scheduled';
alter table public.club_staff_rota_shifts enable row level security;
revoke all on public.club_staff_rota_shifts from public,anon,authenticated;

create table if not exists public.club_schedule_leave_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  staff_user_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  request_note text,
  status text not null default 'requested' check (status in ('requested','approved','declined','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict,
  schedule_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_schedule_leave_valid_window check (ends_at > starts_at),
  foreign key (organisation_id,staff_user_id) references public.club_members(organisation_id,user_id) on delete restrict,
  unique (id,organisation_id),
  unique (schedule_event_id)
);
create index if not exists club_schedule_leave_review_idx on public.club_schedule_leave_requests(organisation_id,status,starts_at);
alter table public.club_schedule_leave_requests enable row level security;
revoke all on public.club_schedule_leave_requests from public,anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='club_schedule_events_id_org_unique') then
    alter table public.club_schedule_events add constraint club_schedule_events_id_org_unique unique(id,organisation_id);
  end if;
end $$;
alter table public.club_schedule_events add column if not exists leave_request_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='club_schedule_leave_event_fk') then
    alter table public.club_schedule_leave_requests add constraint club_schedule_leave_event_fk foreign key(schedule_event_id,organisation_id) references public.club_schedule_events(id,organisation_id) on delete set null (schedule_event_id);
  end if;
  if not exists(select 1 from pg_constraint where conname='club_schedule_event_leave_request_fk') then
    alter table public.club_schedule_events add constraint club_schedule_event_leave_request_fk foreign key(leave_request_id,organisation_id) references public.club_schedule_leave_requests(id,organisation_id) on delete set null (leave_request_id);
  end if;
end $$;
create unique index if not exists club_schedule_leave_event_uq on public.club_schedule_events(leave_request_id) where leave_request_id is not null;
alter table public.club_schedule_events enable row level security;
revoke all on public.club_schedule_events from public,anon,authenticated;

-- Preserve the live RPC signature for deployed clients, but weekly hours are
-- now a guide only. The legacy override arguments are accepted and ignored.
create or replace function public.club_save_schedule_event(p_id uuid,p_organisation_id uuid,p_event_type text,p_staff_user_id uuid,p_customer_id uuid,p_private_client_id uuid,p_location_id uuid,p_external_location text,p_title text,p_internal_notes text,p_starts_at timestamptz,p_ends_at timestamptz,p_status text,p_working_hours_override boolean default false,p_working_hours_override_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare existing public.club_schedule_events%rowtype; result public.club_schedule_events%rowtype; broad boolean; self_trainer boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  broad:=public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') and public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']);
  self_trainer:=public.club_has_active_role(p_organisation_id,array['trainer']) and p_staff_user_id=auth.uid();
  if not broad and not self_trainer then raise exception 'Schedule management is not permitted' using errcode='42501'; end if;
  if p_event_type not in ('pt_session','unavailable','other_location','admin_time','leave') or p_status not in ('scheduled','completed','cancelled','no_show') or p_ends_at<=p_starts_at or nullif(btrim(p_title),'') is null then raise exception 'Invalid schedule item' using errcode='22023'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_staff_user_id and active and role in ('trainer','gym_admin','owner')) then raise exception 'Schedule assignee is not active PT staff in this organisation' using errcode='22023'; end if;
  if p_id is not null then
    select * into existing from public.club_schedule_events where id=p_id and organisation_id=p_organisation_id for update;
    if not found then raise exception 'Schedule item not found' using errcode='P0002'; end if;
    if not broad and existing.staff_user_id<>auth.uid() then raise exception 'You can only manage your own schedule' using errcode='42501'; end if;
  end if;
  if p_event_type='leave' and (p_id is null or existing.event_type<>'leave' or p_status not in ('cancelled','completed')) then raise exception 'Leave is managed through a request and approval.' using errcode='22023'; end if;
  if p_event_type='pt_session' and ((p_customer_id is null)=(p_private_client_id is null) or p_location_id is null) then raise exception 'Choose exactly one member or private client, and a location' using errcode='22023'; end if;
  if p_event_type<>'pt_session' and (p_customer_id is not null or p_private_client_id is not null) then raise exception 'Only PT sessions can be linked to a client' using errcode='22023'; end if;
  if p_event_type='other_location' and p_location_id is null and nullif(btrim(p_external_location),'') is null then raise exception 'Add the other location name' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Member is outside this organisation' using errcode='22023'; end if;
  if p_private_client_id is not null and not exists(select 1 from public.club_schedule_private_clients pc where pc.id=p_private_client_id and pc.organisation_id=p_organisation_id and (broad or pc.created_by=auth.uid() or (p_id is not null and existing.private_client_id=pc.id and existing.staff_user_id=auth.uid()))) then raise exception 'Private client is not available to this Coach' using errcode='42501'; end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Location is unavailable' using errcode='22023'; end if;
  if p_status='scheduled' then perform public.club_assert_schedule_available(p_organisation_id,p_staff_user_id,p_starts_at,p_ends_at,p_id,null); end if;
  if p_id is null then
    insert into public.club_schedule_events(organisation_id,event_type,staff_user_id,customer_id,private_client_id,location_id,external_location,title,internal_notes,starts_at,ends_at,status,created_by,updated_by)
    values(p_organisation_id,p_event_type,p_staff_user_id,p_customer_id,p_private_client_id,p_location_id,nullif(btrim(p_external_location),''),btrim(p_title),nullif(btrim(p_internal_notes),''),p_starts_at,p_ends_at,p_status,auth.uid(),auth.uid()) returning * into result;
  else
    update public.club_schedule_events set event_type=p_event_type,staff_user_id=p_staff_user_id,customer_id=p_customer_id,private_client_id=p_private_client_id,location_id=p_location_id,external_location=nullif(btrim(p_external_location),''),title=btrim(p_title),internal_notes=case when existing.staff_user_id=auth.uid() or public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then nullif(btrim(p_internal_notes),'') else internal_notes end,starts_at=p_starts_at,ends_at=p_ends_at,status=p_status,updated_by=auth.uid(),updated_at=now() where id=p_id returning * into result;
  end if;
  if result.event_type='pt_session' and result.customer_id is not null and (p_id is null or existing.title is distinct from result.title or existing.starts_at is distinct from result.starts_at or existing.ends_at is distinct from result.ends_at or existing.location_id is distinct from result.location_id or existing.staff_user_id is distinct from result.staff_user_id or existing.status is distinct from result.status) then
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id,in_app_visible)
    select p_organisation_id,c.user_id,u.email,'member_service','schedule_update','pending','schedule:'||result.id||':'||result.updated_at::text,now(),'members',jsonb_build_object('eventType',case when p_id is null then 'booked' when result.status='cancelled' then 'cancelled' else 'updated' end,'kind','PT session','title',result.title,'startsAt',result.starts_at,'endsAt',result.ends_at,'location',(select name from public.club_locations where id=result.location_id),'organisationName',(select name from public.club_organisations where id=p_organisation_id)),'schedule_event',result.id,true
    from public.club_customers c join auth.users u on u.id=c.user_id where c.id=result.customer_id and c.organisation_id=p_organisation_id and c.user_id is not null on conflict(organisation_id,idempotency_key) do nothing;
  end if;
  return jsonb_build_object('id',result.id,'event_type',result.event_type,'staff_user_id',result.staff_user_id,'customer_id',result.customer_id,'location_id',result.location_id,'external_location',result.external_location,'title',result.title,'internal_notes',case when public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or result.staff_user_id=auth.uid() then result.internal_notes else null end,'starts_at',result.starts_at,'ends_at',result.ends_at,'status',result.status,'updated_at',result.updated_at);
end; $$;
revoke all on function public.club_save_schedule_event(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,boolean,text) from public,anon;
grant execute on function public.club_save_schedule_event(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,boolean,text) to authenticated;

create or replace function public.club_list_rota_staff(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'Staff')) order by p.first_name,p.last_name),'[]'::jsonb)
from public.club_members m left join public.profiles p on p.id=m.user_id
where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') and auth.uid() is not null
and public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') and public.club_has_active_role(p_organisation_id,array['gym_admin','owner']);
$$;
revoke all on function public.club_list_rota_staff(uuid) from public,anon;
grant execute on function public.club_list_rota_staff(uuid) to authenticated;

create or replace function public.club_save_rota_shift(p_id uuid,p_organisation_id uuid,p_staff_user_id uuid,p_work_date date,p_starts_at time,p_ends_at time,p_location_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.club_staff_rota_shifts%rowtype; actor_role text; old_staff uuid; first_staff uuid; second_staff uuid;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Rota management is restricted to authorised management' using errcode='42501'; end if;
  if p_work_date is null or p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or length(coalesce(p_note,''))>500 then raise exception 'Choose a valid rota date and time' using errcode='22023'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_staff_user_id and active and role in ('trainer','gym_staff','gym_admin','owner')) then raise exception 'Choose active Madhouse staff' using errcode='22023'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active and (lower(name) like '%rotherham%' or lower(name) like '%carlton%')) then raise exception 'Choose the existing Rotherham or Carlton location' using errcode='22023'; end if;
  if p_id is not null then select * into result from public.club_staff_rota_shifts where id=p_id and organisation_id=p_organisation_id for update; if not found then raise exception 'Rota shift not found' using errcode='P0002'; end if; old_staff:=result.staff_user_id; end if;
  if old_staff is null or old_staff=p_staff_user_id then perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||p_staff_user_id::text||':rota',0));
  else first_staff:=least(old_staff,p_staff_user_id);second_staff:=greatest(old_staff,p_staff_user_id);perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||first_staff::text||':rota',0));perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':'||second_staff::text||':rota',0)); end if;
  if exists(select 1 from public.club_staff_rota_shifts s where s.organisation_id=p_organisation_id and s.staff_user_id=p_staff_user_id and s.work_date=p_work_date and s.status='scheduled' and s.id is distinct from p_id and s.starts_at<p_ends_at and s.ends_at>p_starts_at) then raise exception 'This staff member already has a rota shift at that time.' using errcode='23P01'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  if p_id is null then
    insert into public.club_staff_rota_shifts(organisation_id,staff_user_id,work_date,starts_at,ends_at,location_id,note,created_by,updated_by) values(p_organisation_id,p_staff_user_id,p_work_date,p_starts_at,p_ends_at,p_location_id,nullif(btrim(p_note),''),auth.uid(),auth.uid()) returning * into result;
  else
    update public.club_staff_rota_shifts set staff_user_id=p_staff_user_id,work_date=p_work_date,starts_at=p_starts_at,ends_at=p_ends_at,location_id=p_location_id,note=nullif(btrim(p_note),''),updated_by=auth.uid(),updated_at=now(),status='scheduled' where id=p_id returning * into result;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,case when p_id is null then 'schedule.rota.created' else 'schedule.rota.updated' end,'rota_shift',result.id,jsonb_build_object('staff_user_id',result.staff_user_id,'work_date',result.work_date,'starts_at',result.starts_at,'ends_at',result.ends_at,'location_id',result.location_id));
  return jsonb_build_object('id',result.id);
end; $$;
revoke all on function public.club_save_rota_shift(uuid,uuid,uuid,date,time,time,uuid,text) from public,anon;
grant execute on function public.club_save_rota_shift(uuid,uuid,uuid,date,time,time,uuid,text) to authenticated;

create or replace function public.club_cancel_rota_shift(p_organisation_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target public.club_staff_rota_shifts%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Rota management is restricted to authorised management' using errcode='42501'; end if;
  update public.club_staff_rota_shifts set status='cancelled',updated_by=auth.uid(),updated_at=now() where id=p_id and organisation_id=p_organisation_id and status='scheduled' returning * into target;
  if not found then raise exception 'Rota shift not found' using errcode='P0002'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.rota.cancelled','rota_shift',target.id,jsonb_build_object('staff_user_id',target.staff_user_id,'work_date',target.work_date,'location_id',target.location_id));
end; $$;
revoke all on function public.club_cancel_rota_shift(uuid,uuid) from public,anon;
grant execute on function public.club_cancel_rota_shift(uuid,uuid) to authenticated;

create or replace function public.club_submit_leave_request(p_organisation_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.club_schedule_leave_requests%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['trainer','gym_staff','gym_admin','owner']) then raise exception 'Leave requests require an active staff account' using errcode='42501'; end if;
  if p_ends_at<=p_starts_at or length(coalesce(p_note,''))>1000 then raise exception 'Choose a valid leave period' using errcode='22023'; end if;
  insert into public.club_schedule_leave_requests(organisation_id,staff_user_id,starts_at,ends_at,request_note,created_by) values(p_organisation_id,auth.uid(),p_starts_at,p_ends_at,nullif(btrim(p_note),''),auth.uid()) returning * into result;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.leave.requested','leave_request',result.id,jsonb_build_object('starts_at',result.starts_at,'ends_at',result.ends_at));
  return jsonb_build_object('id',result.id);
end; $$;
revoke all on function public.club_submit_leave_request(uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.club_submit_leave_request(uuid,timestamptz,timestamptz,text) to authenticated;

create or replace function public.club_review_leave_request(p_organisation_id uuid,p_id uuid,p_decision text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare request public.club_schedule_leave_requests%rowtype; actor_role text; created_event uuid;
begin
  if auth.uid() is null or p_decision not in ('approved','declined') or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Only authorised management can review leave requests' using errcode='42501'; end if;
  select * into request from public.club_schedule_leave_requests where id=p_id and organisation_id=p_organisation_id for update;
  if not found or request.status<>'requested' then raise exception 'Leave request is no longer awaiting review' using errcode='P0002'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  if p_decision='approved' then
    perform public.club_assert_schedule_available(p_organisation_id,request.staff_user_id,request.starts_at,request.ends_at,null,null);
    insert into public.club_schedule_events(organisation_id,event_type,staff_user_id,title,internal_notes,starts_at,ends_at,status,created_by,updated_by,leave_request_id)
    values(p_organisation_id,'leave',request.staff_user_id,'Approved leave',request.request_note,request.starts_at,request.ends_at,'scheduled',auth.uid(),auth.uid(),request.id) returning id into created_event;
  end if;
  update public.club_schedule_leave_requests set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),schedule_event_id=created_event,updated_at=now() where id=request.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.leave.'||p_decision,'leave_request',request.id,jsonb_build_object('staff_user_id',request.staff_user_id,'starts_at',request.starts_at,'ends_at',request.ends_at));
end; $$;
revoke all on function public.club_review_leave_request(uuid,uuid,text) from public,anon;
grant execute on function public.club_review_leave_request(uuid,uuid,text) to authenticated;

create or replace function public.club_cancel_leave_request(p_organisation_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare request public.club_schedule_leave_requests%rowtype; actor_role text;
begin
  select * into request from public.club_schedule_leave_requests where id=p_id and organisation_id=p_organisation_id for update;
  if not found or auth.uid() is null or (request.staff_user_id<>auth.uid() and (not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage'))) then raise exception 'You cannot cancel this leave request' using errcode='42501'; end if;
  if request.status not in ('requested','approved') then raise exception 'This leave request can no longer be cancelled' using errcode='22023'; end if;
  if request.schedule_event_id is not null then update public.club_schedule_events set status='cancelled',updated_by=auth.uid(),updated_at=now() where id=request.schedule_event_id and organisation_id=p_organisation_id; end if;
  update public.club_schedule_leave_requests set status='cancelled',cancelled_by=auth.uid(),updated_at=now() where id=request.id;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.leave.cancelled','leave_request',request.id,jsonb_build_object('previous_status',request.status));
end; $$;
revoke all on function public.club_cancel_leave_request(uuid,uuid) from public,anon;
grant execute on function public.club_cancel_leave_request(uuid,uuid) to authenticated;

-- Shared calendar stays staff-only. Rota is visible to managers and the shift
-- holder; pending leave is visible only to its requester and management.
create or replace function public.club_list_shared_schedule(p_organisation_id uuid,p_from timestamptz,p_to timestamptz,p_staff_user_id uuid default null,p_location_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare can_view boolean:=public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage'); can_notes boolean:=public.club_has_active_role(p_organisation_id,array['gym_admin','owner']); manager boolean:=can_notes and can_view;
begin
  if auth.uid() is null or not can_view then raise exception 'Schedule access is not permitted' using errcode='42501'; end if;
  if p_to<=p_from or p_to-p_from>interval '62 days' then raise exception 'Invalid schedule window' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(x.item order by x.starts_at) from (
    select jsonb_build_object('id',e.id,'leaveRequestId',e.leave_request_id,'eventType',e.event_type,'staffUserId',e.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'PT'),'customerId',case when e.private_client_id is null or can_notes or e.staff_user_id=auth.uid() then e.customer_id end,'privateClientId',case when e.private_client_id is null or can_notes or e.staff_user_id=auth.uid() then e.private_client_id end,'memberName',case when e.private_client_id is not null then case when can_notes or e.staff_user_id=auth.uid() then pc.display_name end else c.display_name end,'locationId',e.location_id,'locationName',l.name,'externalLocation',e.external_location,'title',case when e.private_client_id is not null and not (can_notes or e.staff_user_id=auth.uid()) then 'PT session' else e.title end,'notes',case when can_notes or e.staff_user_id=auth.uid() then e.internal_notes end,'startsAt',e.starts_at,'endsAt',e.ends_at,'status',e.status) item,e.starts_at
    from public.club_schedule_events e join public.club_members m on m.organisation_id=e.organisation_id and m.user_id=e.staff_user_id and m.active left join public.profiles p on p.id=e.staff_user_id left join public.club_customers c on c.id=e.customer_id and c.organisation_id=e.organisation_id left join public.club_schedule_private_clients pc on pc.id=e.private_client_id and pc.organisation_id=e.organisation_id left join public.club_locations l on l.id=e.location_id and l.organisation_id=e.organisation_id where e.organisation_id=p_organisation_id and e.starts_at<p_to and e.ends_at>p_from and (p_staff_user_id is null or e.staff_user_id=p_staff_user_id) and (p_location_id is null or e.location_id=p_location_id)
    union all
    select jsonb_build_object('id',s.id,'eventType','class','staffUserId',s.host_user_id,'staffName',coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),'Instructor'),'customerId',null,'memberName',null,'locationId',s.location_id,'locationName',l.name,'externalLocation',null,'title',coalesce(s.title,t.name),'description',t.description,'capacity',s.capacity,'notes',null,'startsAt',s.starts_at,'endsAt',s.ends_at,'status',s.status) item,s.starts_at from public.club_class_sessions s left join public.profiles p on p.id=s.host_user_id left join public.club_locations l on l.id=s.location_id and l.organisation_id=s.organisation_id left join public.club_class_types t on t.id=s.class_type_id and t.organisation_id=s.organisation_id where s.organisation_id=p_organisation_id and s.starts_at<p_to and s.ends_at>p_from and (p_staff_user_id is null or s.host_user_id=p_staff_user_id) and (p_location_id is null or s.location_id=p_location_id)
    union all
    select jsonb_build_object('id',r.id,'eventType','rota_shift','staffUserId',r.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'Staff'),'customerId',null,'memberName',null,'locationId',r.location_id,'locationName',l.name,'externalLocation',null,'title','Rota shift','notes',case when manager then r.note end,'startsAt',(r.work_date+r.starts_at) at time zone 'Europe/London','endsAt',(r.work_date+r.ends_at) at time zone 'Europe/London','status',r.status) item,(r.work_date+r.starts_at) at time zone 'Europe/London' from public.club_staff_rota_shifts r join public.club_locations l on l.id=r.location_id and l.organisation_id=r.organisation_id left join public.profiles p on p.id=r.staff_user_id where r.organisation_id=p_organisation_id and r.status='scheduled' and (manager or r.staff_user_id=auth.uid()) and r.work_date between (p_from at time zone 'Europe/London')::date and (p_to at time zone 'Europe/London')::date and (p_staff_user_id is null or r.staff_user_id=p_staff_user_id) and (p_location_id is null or r.location_id=p_location_id)
    union all
    select jsonb_build_object('id',q.id,'eventType','leave_request','staffUserId',q.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'Staff'),'customerId',null,'memberName',null,'locationId',null,'locationName',null,'externalLocation',null,'title','Leave request','notes',case when manager or q.staff_user_id=auth.uid() then q.request_note end,'startsAt',q.starts_at,'endsAt',q.ends_at,'status',q.status) item,q.starts_at from public.club_schedule_leave_requests q left join public.profiles p on p.id=q.staff_user_id where q.organisation_id=p_organisation_id and q.status='requested' and (manager or q.staff_user_id=auth.uid()) and q.starts_at<p_to and q.ends_at>p_from and (p_staff_user_id is null or q.staff_user_id=p_staff_user_id)
  ) x),'[]'::jsonb);
end; $$;
revoke all on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) to authenticated;

-- Weekly hours remain an optional guide. Existing rows and legacy override
-- columns are preserved as history; they no longer participate in permission.
