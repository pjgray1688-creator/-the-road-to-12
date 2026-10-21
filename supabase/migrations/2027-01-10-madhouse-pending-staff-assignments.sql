-- Preserve operational staff identity before a person accepts their existing
-- Club invitation. These rows are not Auth users and carry no permissions.
begin;
create table if not exists public.club_madhouse_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  canonical_name text not null check (length(btrim(canonical_name)) between 1 and 120),
  normalized_name text not null,
  location_ids uuid[] not null default '{}',
  staff_grant_id uuid references public.club_staff_access_grants(id) on delete restrict,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organisation_id,normalized_name),
  unique(id,organisation_id)
);
alter table public.club_madhouse_staff_assignments enable row level security;
revoke all on public.club_madhouse_staff_assignments from public,anon,authenticated;
create unique index if not exists club_madhouse_staff_assignment_grant_uq
  on public.club_madhouse_staff_assignments(staff_grant_id) where staff_grant_id is not null;

alter table public.club_madhouse_class_templates add column if not exists instructor_assignment_id uuid;
alter table public.club_class_sessions add column if not exists instructor_assignment_id uuid;
alter table public.club_class_sessions add column if not exists instructor_name_snapshot text;
alter table public.club_staff_rota_shifts add column if not exists staff_assignment_id uuid;
alter table public.club_staff_rota_shifts alter column staff_user_id drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.club_madhouse_class_templates'::regclass and conname='club_madhouse_template_staff_assignment_fk') then
    alter table public.club_madhouse_class_templates add constraint club_madhouse_template_staff_assignment_fk foreign key(instructor_assignment_id,organisation_id) references public.club_madhouse_staff_assignments(id,organisation_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.club_class_sessions'::regclass and conname='club_class_session_staff_assignment_fk') then
    alter table public.club_class_sessions add constraint club_class_session_staff_assignment_fk foreign key(instructor_assignment_id,organisation_id) references public.club_madhouse_staff_assignments(id,organisation_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.club_staff_rota_shifts'::regclass and conname='club_staff_rota_assignment_fk') then
    alter table public.club_staff_rota_shifts add constraint club_staff_rota_assignment_fk foreign key(staff_assignment_id,organisation_id) references public.club_madhouse_staff_assignments(id,organisation_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.club_staff_rota_shifts'::regclass and conname='club_staff_rota_identity_xor_ck') then
    alter table public.club_staff_rota_shifts add constraint club_staff_rota_identity_xor_ck check ((staff_user_id is not null) <> (staff_assignment_id is not null)) not valid;
    alter table public.club_staff_rota_shifts validate constraint club_staff_rota_identity_xor_ck;
  end if;
end $$;

-- Stable operational identities are intentionally independent of Auth IDs.
insert into public.club_madhouse_staff_assignments(organisation_id,canonical_name,normalized_name,location_ids)
values
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Steve','steve','{06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Amie','amie','{4a2c01b7-447e-413a-a1a5-1cdef9b24163,06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Keenan','keenan','{4a2c01b7-447e-413a-a1a5-1cdef9b24163,06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Shannon','shannon','{06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Cody','cody','{06a02ac4-225a-4430-8aa4-13143a27945a}'),
 ('fa44592a-1593-4ad3-a621-63a4a4bcbceb','Luke','luke','{4a2c01b7-447e-413a-a1a5-1cdef9b24163}')
on conflict(organisation_id,normalized_name) do nothing;
update public.club_madhouse_class_templates t set instructor_assignment_id=a.id
from public.club_madhouse_staff_assignments a where a.organisation_id=t.organisation_id and a.normalized_name=lower(regexp_replace(t.instructor_name,'[^a-z]','','g'))
and t.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb';

create or replace function public.club_madhouse_attach_staff_invitation(p_organisation_id uuid,p_assignment_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare a public.club_madhouse_staff_assignments%rowtype; g public.club_staff_access_grants%rowtype; old_role text; old_coach boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff assignment management is not permitted' using errcode='42501'; end if;
  select * into a from public.club_madhouse_staff_assignments where id=p_assignment_id and organisation_id=p_organisation_id and active for update;
  select * into g from public.club_staff_access_grants where id=p_grant_id and organisation_id=p_organisation_id and status in ('pending','accepted') and (status='accepted' or expires_at>now()) for update;
  if not found or a.id is null then raise exception 'Staff assignment or valid invitation not found' using errcode='P0002'; end if;
  if lower(regexp_replace(split_part(coalesce(g.display_name,''),' ',1),'[^a-z]','','g'))<>a.normalized_name then raise exception 'Invitation name does not match the prepared staff identity' using errcode='22023'; end if;
  if g.status='pending' then
    -- Reuse the invitation/token while preparing the least-privilege Club
    -- staff role and the separately requested Coach permission for this rota.
    old_role:=g.intended_role; old_coach:=g.coach_requested;
    update public.club_staff_access_grants set intended_role='trainer',capabilities=public.club_capabilities_for_role('trainer'),coach_requested=true,location_ids=a.location_ids where id=g.id returning * into g;
  elsif g.intended_role not in ('trainer','gym_admin') or not g.coach_requested or not (a.location_ids <@ g.location_ids) then
    raise exception 'Accepted instructor access does not match the prepared role and locations' using errcode='42501';
  end if;
  update public.club_madhouse_staff_assignments set staff_grant_id=g.id where id=a.id;
  if g.status='accepted' then
    update public.club_class_sessions set host_user_id=g.accepted_by where instructor_assignment_id=a.id and host_user_id is null and starts_at>now();
    update public.club_staff_rota_shifts set staff_user_id=g.accepted_by,staff_assignment_id=null where staff_assignment_id=a.id and work_date>=(now() at time zone 'Europe/London')::date;
  end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    select p_organisation_id,auth.uid(),m.role,'staff.operational_identity_linked','staff_assignment',a.id,jsonb_build_object('grant_id',g.id,'status',g.status,'previous_role',old_role,'previous_coach_requested',old_coach,'prepared_role',g.intended_role,'coach_requested',g.coach_requested,'location_ids',g.location_ids) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return jsonb_build_object('assignment_id',a.id,'grant_id',g.id,'status',g.status);
end; $$;
revoke all on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) from public,anon;
grant execute on function public.club_madhouse_attach_staff_invitation(uuid,uuid,uuid) to authenticated;

create or replace function public.club_madhouse_list_staff_assignments(p_organisation_id uuid)
returns table(assignment_id uuid,canonical_name text,location_ids uuid[],staff_grant_id uuid,grant_status text)
language sql security definer set search_path=pg_catalog,public as $$
  select a.id,a.canonical_name,a.location_ids,a.staff_grant_id,g.status
  from public.club_madhouse_staff_assignments a left join public.club_staff_access_grants g on g.id=a.staff_grant_id
  where a.organisation_id=p_organisation_id and a.active
    and auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage')
  order by a.canonical_name
$$;
revoke all on function public.club_madhouse_list_staff_assignments(uuid) from public,anon;
grant execute on function public.club_madhouse_list_staff_assignments(uuid) to authenticated;

-- Claiming an invitation reconciles prepared rota/classes to the real Auth user.
create or replace function public.club_madhouse_reconcile_staff_claim()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='accepted' and old.status is distinct from new.status and new.accepted_by is not null then
    update public.club_class_sessions s set host_user_id=new.accepted_by
      from public.club_madhouse_staff_assignments a where a.staff_grant_id=new.id and s.instructor_assignment_id=a.id and s.host_user_id is null and s.starts_at>now();
    update public.club_staff_rota_shifts r set staff_user_id=new.accepted_by,staff_assignment_id=null
      from public.club_madhouse_staff_assignments a where a.staff_grant_id=new.id and r.staff_assignment_id=a.id and r.work_date>=(now() at time zone 'Europe/London')::date;
  end if;
  return new;
end; $$;
drop trigger if exists club_madhouse_staff_claim_reconcile on public.club_staff_access_grants;
create trigger club_madhouse_staff_claim_reconcile after update of status on public.club_staff_access_grants for each row execute function public.club_madhouse_reconcile_staff_claim();

-- Keep generator permission checks. Pending identities are linked only to
-- verified invitation rows created through the existing manager workflow.
create or replace function public.club_madhouse_generate_class_sessions(p_organisation_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare t public.club_madhouse_class_templates%rowtype; d date; a public.club_madhouse_staff_assignments%rowtype; staff_id uuid; loc_id uuid; class_type uuid; n integer; created_n integer:=0; exists_n integer:=0; conflict_n integer:=0; start_at timestamptz; sess public.club_class_sessions%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Class schedule management is restricted to authorised management' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from<greatest((now() at time zone 'Europe/London')::date,date '2026-10-19') or p_to<p_from or p_to-p_from>366 then raise exception 'Choose future class dates in the confirmed timetable window' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for t in select * from public.club_madhouse_class_templates where organisation_id=p_organisation_id and active order by weekday,template_key loop
    perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':madhouse-class:'||t.template_key,0));
    select * into a from public.club_madhouse_staff_assignments where id=t.instructor_assignment_id and organisation_id=p_organisation_id and active;
    if not found then raise exception 'Template % has no verified operational instructor assignment',t.template_key using errcode='55000'; end if;
    staff_id:=null;
    if a.staff_grant_id is not null then
      select g.accepted_by into staff_id from public.club_staff_access_grants g where g.id=a.staff_grant_id and g.organisation_id=p_organisation_id and g.status in ('pending','accepted') and (g.status='accepted' or g.expires_at>now()) and (g.status='pending' or g.accepted_by is not null) and g.intended_role in ('trainer','gym_admin') and g.coach_requested and a.normalized_name=lower(regexp_replace(split_part(g.display_name,' ',1),'[^a-z]','','g')) and a.location_ids <@ g.location_ids;
      if not found then raise exception 'Instructor invitation link is invalid for %',a.canonical_name using errcode='55000'; end if;
    else
      select count(*),min(m.user_id::text)::uuid into n,staff_id from public.club_members m join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') and lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g'))=a.normalized_name;
      if n>1 then raise exception 'Instructor identity for % is ambiguous',a.canonical_name using errcode='55000'; end if;
      if n=0 and a.staff_grant_id is null then null; end if;
    end if;
    if cardinality(a.location_ids)=0 then raise exception 'Instructor has no locations assigned' using errcode='55000'; end if;
    select count(*),min(l.id::text)::uuid into n,loc_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(t.location_name) and l.id=any(a.location_ids);
    if n<>1 then raise exception 'Instructor/location mapping for template % is invalid',t.template_key using errcode='55000'; end if;
    insert into public.club_class_types(organisation_id,name,description,default_duration_minutes,default_capacity) values(p_organisation_id,t.class_name,'Scheduling window up to 60 minutes; actual class duration is not confirmed.',60,6) on conflict(organisation_id,name) do nothing returning id into class_type;
    if class_type is null then select id into class_type from public.club_class_types where organisation_id=p_organisation_id and name=t.class_name and active; end if;
    if class_type is null then raise exception 'Active class type unavailable: %',t.class_name using errcode='55000'; end if;
    for d in select x::date from generate_series(p_from,p_to,interval '1 day') x where extract(isodow from x)=t.weekday loop
      if d<coalesce(t.effective_from,date '2026-10-19') then continue; end if;
      if exists(select 1 from public.club_class_sessions s where s.organisation_id=p_organisation_id and s.source_template_key=t.template_key and s.source_template_date=d) then exists_n:=exists_n+1; continue; end if;
      start_at:=(d+t.starts_local) at time zone 'Europe/London'; if start_at<=now() then continue; end if;
      if staff_id is not null and exists(select 1 from public.club_class_sessions s where s.organisation_id=p_organisation_id and s.host_user_id=staff_id and s.status='scheduled' and s.starts_at<start_at+interval '60 minutes' and s.ends_at>start_at) then conflict_n:=conflict_n+1; continue; end if;
      insert into public.club_class_sessions(organisation_id,location_id,class_type_id,host_user_id,instructor_assignment_id,instructor_name_snapshot,title,starts_at,ends_at,capacity,max_transformation_credit_bookings,visibility,status,source_template_key,source_template_date)
      values(p_organisation_id,loc_id,class_type,staff_id,a.id,a.canonical_name,t.class_name,start_at,start_at+interval '60 minutes',6,2,'public','scheduled',t.template_key,d) on conflict(organisation_id,source_template_key,source_template_date) where source_template_key is not null do nothing returning * into sess;
      if not found then exists_n:=exists_n+1; continue; end if;
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.class.generated','class_session',sess.id,jsonb_build_object('template_key',t.template_key,'work_date',d,'location_id',loc_id,'host_user_id',staff_id,'instructor_assignment_id',a.id)); created_n:=created_n+1;
    end loop;
  end loop;
  return jsonb_build_object('created',created_n,'alreadyGenerated',exists_n,'skippedConflicts',conflict_n,'from',p_from,'to',p_to,'timeZone','Europe/London');
end; $$;
revoke all on function public.club_madhouse_generate_class_sessions(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_class_sessions(uuid,date,date) to authenticated;

create or replace function public.club_madhouse_generate_rota(p_organisation_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare t public.club_madhouse_rota_templates%rowtype; d date; a public.club_madhouse_staff_assignments%rowtype; staff_id uuid; loc_id uuid; n integer; created_n integer:=0; exists_n integer:=0; conflict_n integer:=0; sh public.club_staff_rota_shifts%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Rota management is restricted to authorised management' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from<(now() at time zone 'Europe/London')::date or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a future rota window of up to one year' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for t in select * from public.club_madhouse_rota_templates where organisation_id=p_organisation_id and active order by weekday,template_key loop
    select * into a from public.club_madhouse_staff_assignments where organisation_id=p_organisation_id and normalized_name=lower(regexp_replace(t.staff_name,'[^a-z]','','g')) and active;
    if not found then raise exception 'Rota staff % has no operational identity',t.staff_name using errcode='55000'; end if;
    staff_id:=null;
    if a.staff_grant_id is not null then
      select g.accepted_by into staff_id from public.club_staff_access_grants g where g.id=a.staff_grant_id and g.organisation_id=p_organisation_id and g.status in ('pending','accepted') and (g.status='accepted' or g.expires_at>now()) and (g.status='pending' or g.accepted_by is not null) and lower(regexp_replace(split_part(coalesce(g.display_name,''),' ',1),'[^a-z]','','g'))=a.normalized_name and a.location_ids <@ g.location_ids;
      if not found then raise exception 'Staff invitation link is invalid for %',a.canonical_name using errcode='55000'; end if;
    else
      select count(*),min(m.user_id::text)::uuid into n,staff_id from public.club_members m join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') and lower(regexp_replace(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1)),'[^a-z]','','g'))=a.normalized_name;
      if n>1 then raise exception 'Staff identity for % is ambiguous',a.canonical_name using errcode='55000'; end if;
    end if;
    select count(*),min(l.id::text)::uuid into n,loc_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(t.location_name) and l.id=any(a.location_ids);
    if n<>1 then raise exception 'Staff/location mapping for rota template % is invalid',t.template_key using errcode='55000'; end if;
    for d in select x::date from generate_series(p_from,p_to,interval '1 day') x where extract(isodow from x)=t.weekday loop
      if d<coalesce(t.effective_from,(now() at time zone 'Europe/London')::date) then continue; end if;
      if exists(select 1 from public.club_staff_rota_shifts r where r.organisation_id=p_organisation_id and r.source_template_key=t.template_key and r.work_date=d) then exists_n:=exists_n+1; continue; end if;
      perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':madhouse-rota-staff:'||a.id::text||':'||d::text,0));
      if exists(select 1 from public.club_staff_rota_shifts r where r.organisation_id=p_organisation_id and r.work_date=d and r.status='scheduled' and r.starts_at<t.ends_local and r.ends_at>t.starts_local and ((staff_id is not null and r.staff_user_id=staff_id) or (staff_id is null and r.staff_assignment_id=a.id))) then conflict_n:=conflict_n+1; continue; end if;
      insert into public.club_staff_rota_shifts(organisation_id,staff_user_id,staff_assignment_id,work_date,starts_at,ends_at,location_id,note,created_by,updated_by,source_template_key)
      values(p_organisation_id,staff_id,case when staff_id is null then a.id else null end,d,t.starts_local,t.ends_local,loc_id,'Generated from approved Madhouse weekly rota template',auth.uid(),auth.uid(),t.template_key)
      on conflict(organisation_id,source_template_key,work_date) where source_template_key is not null do nothing returning * into sh;
      if not found then exists_n:=exists_n+1; continue; end if;
      insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),actor_role,'schedule.rota.created','rota_shift',sh.id,jsonb_build_object('staff_user_id',staff_id,'staff_assignment_id',case when staff_id is null then a.id else null end,'work_date',d,'starts_at',t.starts_local,'ends_at',t.ends_local,'location_id',loc_id,'template_key',t.template_key)); created_n:=created_n+1;
    end loop;
  end loop;
  return jsonb_build_object('created',created_n,'alreadyGenerated',exists_n,'skippedConflicts',conflict_n,'from',p_from,'to',p_to);
end; $$;
revoke all on function public.club_madhouse_generate_rota(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_rota(uuid,date,date) to authenticated;

-- Keep pending names visible in the existing staff calendar without creating
-- an Auth profile. All former privacy and caller checks remain in force.
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
    select jsonb_build_object('id',s.id,'eventType','class','staffUserId',s.host_user_id,'staffName',coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),s.instructor_name_snapshot,'Instructor'),'customerId',null,'memberName',null,'locationId',s.location_id,'locationName',l.name,'externalLocation',null,'title',coalesce(s.title,t.name),'description',t.description,'capacity',s.capacity,'notes',null,'startsAt',s.starts_at,'endsAt',s.ends_at,'status',s.status) item,s.starts_at from public.club_class_sessions s left join public.profiles p on p.id=s.host_user_id left join public.club_locations l on l.id=s.location_id and l.organisation_id=s.organisation_id left join public.club_class_types t on t.id=s.class_type_id and t.organisation_id=s.organisation_id where s.organisation_id=p_organisation_id and s.starts_at<p_to and s.ends_at>p_from and (p_staff_user_id is null or s.host_user_id=p_staff_user_id) and (p_location_id is null or s.location_id=p_location_id)
    union all
    select jsonb_build_object('id',r.id,'eventType','rota_shift','staffUserId',r.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),a.canonical_name,'Staff'),'customerId',null,'memberName',null,'locationId',r.location_id,'locationName',l.name,'externalLocation',null,'title','Rota shift','notes',case when manager then r.note end,'startsAt',(r.work_date+r.starts_at) at time zone 'Europe/London','endsAt',(r.work_date+r.ends_at) at time zone 'Europe/London','status',r.status) item,(r.work_date+r.starts_at) at time zone 'Europe/London' from public.club_staff_rota_shifts r join public.club_locations l on l.id=r.location_id and l.organisation_id=r.organisation_id left join public.profiles p on p.id=r.staff_user_id left join public.club_madhouse_staff_assignments a on a.id=r.staff_assignment_id and a.organisation_id=r.organisation_id where r.organisation_id=p_organisation_id and r.status='scheduled' and (manager or r.staff_user_id=auth.uid()) and r.work_date between (p_from at time zone 'Europe/London')::date and (p_to at time zone 'Europe/London')::date and (p_staff_user_id is null or r.staff_user_id=p_staff_user_id) and (p_location_id is null or r.location_id=p_location_id)
    union all
    select jsonb_build_object('id',q.id,'eventType','leave_request','staffUserId',q.staff_user_id,'staffName',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.display_name,''),'Staff'),'customerId',null,'memberName',null,'locationId',null,'locationName',null,'externalLocation',null,'title','Leave request','notes',case when manager or q.staff_user_id=auth.uid() then q.request_note end,'startsAt',q.starts_at,'endsAt',q.ends_at,'status',q.status) item,q.starts_at from public.club_schedule_leave_requests q left join public.profiles p on p.id=q.staff_user_id where q.organisation_id=p_organisation_id and q.status='requested' and (manager or q.staff_user_id=auth.uid()) and q.starts_at<p_to and q.ends_at>p_from and (p_staff_user_id is null or q.staff_user_id=p_staff_user_id)
  ) x),'[]'::jsonb);
end; $$;
revoke all on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.club_list_shared_schedule(uuid,timestamptz,timestamptz,uuid,uuid) to authenticated;

commit;

