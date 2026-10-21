-- Forward-only Madhouse operations hotfix. Previous numbered migrations are
-- already recorded in production; this migration only replaces these three
-- idempotent function definitions and preserves their existing permissions.
begin;

create or replace function public.club_madhouse_seed_daily_checks(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare actor_role text; loc record; v_template_id uuid; item record; inserted integer:=0; location_id uuid; matches integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Daily check setup is restricted to authorised management' using errcode='42501'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for loc in select * from (values('Rotherham','Rotherham'),('Carlton','Carlton')) as x(location_key,location_name) loop
    select count(*),min(l.id::text)::uuid into matches,location_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(loc.location_name);
    if matches<>1 then raise exception 'Daily checks require exactly one active % location',loc.location_name using errcode='55000'; end if;
    insert into public.club_checklist_templates(organisation_id,name,check_type,active,created_by,source_key)
      values(p_organisation_id,'Madhouse daily checks · '||loc.location_name,'daily',true,auth.uid(),'madhouse-daily-'||lower(loc.location_key))
      on conflict(organisation_id,source_key) where source_key is not null do update set name=excluded.name,check_type='daily',active=true,updated_at=now() returning id into v_template_id;
    insert into public.club_checklist_template_locations(template_id,organisation_id,location_id,assigned_by)
      values(v_template_id,p_organisation_id,location_id,auth.uid()) on conflict(template_id,location_id) do nothing;
    for item in select * from (values
      ('routine-bins','Routine','Empty bins when full',null::smallint),
      ('routine-hoover','Routine','Hoover',null::smallint),
      ('routine-touch-points','Routine','Wipe touch points',null::smallint),
      ('routine-upholstery','Routine','Spray-clean equipment upholstery',null::smallint),
      ('routine-metal-frames','Routine','Clean equipment metal frames',null::smallint),
      ('routine-reception','Routine','Organise reception and desk area',null::smallint),
      ('routine-weights','Routine','Return loose weights to correct positions',null::smallint),
      ('monday-toilets','Scheduled','Deep-clean toilets',1::smallint),
      ('tuesday-mirrors','Scheduled',case when loc.location_key='Carlton' then 'Clean gym, toilet and sunbed mirrors' else 'Clean gym and toilet mirrors' end,2::smallint),
      ('thursday-toilets','Scheduled','Deep-clean toilets',4::smallint),
      ('carlton-tuesday-sunbeds','Scheduled','Deep-clean Carlton sunbed rooms',2::smallint),
      ('carlton-saturday-sunbeds','Scheduled','Deep-clean Carlton sunbed rooms',6::smallint),
      ('rotherham-wednesday-mats','Scheduled','Steam-clean mats · Rotherham',3::smallint),
      ('carlton-thursday-mats','Scheduled','Steam-clean mats · Carlton',4::smallint)
    ) as x(item_key,section,label,weekday) where
      (loc.location_key='Carlton' or item_key not in ('carlton-tuesday-sunbeds','carlton-saturday-sunbeds','carlton-thursday-mats'))
      and (loc.location_key='Rotherham' or item_key<>'rotherham-wednesday-mats') loop
      insert into public.club_checklist_items(template_id,organisation_id,section,label,required,sort_order,active,created_by,source_key,scheduled_weekday)
        values(v_template_id,p_organisation_id,item.section,item.label,true,case when item.weekday is null then 10 else 20+item.weekday end,true,auth.uid(),item.item_key,item.weekday)
        on conflict(template_id,source_key) where source_key is not null do update set section=excluded.section,label=excluded.label,required=true,sort_order=excluded.sort_order,active=true,scheduled_weekday=excluded.scheduled_weekday,updated_at=now();
      inserted:=inserted+1;
    end loop;
    perform public.club_append_audit_event(p_organisation_id,'venue.madhouse_checks_seeded','checklist_template',v_template_id,location_id,null,jsonb_build_object('source','madhouse-weekly-checks','actor_role',actor_role));
  end loop;
  return jsonb_build_object('templates',2,'items',inserted,'locations',2);
end; $$;

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
      select g.accepted_by into staff_id from public.club_staff_access_grants g where g.id=a.staff_grant_id and g.organisation_id=p_organisation_id and g.status in ('pending','accepted') and (g.status='accepted' or g.expires_at>now()) and (g.status='pending' or g.accepted_by is not null) and g.intended_role in ('trainer','gym_admin') and g.coach_requested and a.normalized_name=regexp_replace(lower(split_part(g.display_name,' ',1)),'[^a-z]','','g') and a.location_ids <@ g.location_ids;
      if not found then raise exception 'Instructor invitation link is invalid for %',a.canonical_name using errcode='55000'; end if;
    else
      select count(*),min(m.user_id::text)::uuid into n,staff_id from public.club_members m join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') and regexp_replace(lower(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1))),'[^a-z]','','g')=a.normalized_name;
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

create or replace function public.club_madhouse_generate_rota(p_organisation_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare t public.club_madhouse_rota_templates%rowtype; d date; a public.club_madhouse_staff_assignments%rowtype; staff_id uuid; loc_id uuid; n integer; created_n integer:=0; exists_n integer:=0; conflict_n integer:=0; sh public.club_staff_rota_shifts%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'classes.manage') then raise exception 'Rota management is restricted to authorised management' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from<(now() at time zone 'Europe/London')::date or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a future rota window of up to one year' using errcode='22023'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for t in select * from public.club_madhouse_rota_templates where organisation_id=p_organisation_id and active order by weekday,template_key loop
    select * into a from public.club_madhouse_staff_assignments where organisation_id=p_organisation_id and normalized_name=regexp_replace(lower(t.staff_name),'[^a-z]','','g') and active;
    if not found then raise exception 'Rota staff % has no operational identity',t.staff_name using errcode='55000'; end if;
    staff_id:=null;
    if a.staff_grant_id is not null then
      select g.accepted_by into staff_id from public.club_staff_access_grants g where g.id=a.staff_grant_id and g.organisation_id=p_organisation_id and g.status in ('pending','accepted') and (g.status='accepted' or g.expires_at>now()) and (g.status='pending' or g.accepted_by is not null) and regexp_replace(lower(split_part(coalesce(g.display_name,''),' ',1)),'[^a-z]','','g')=a.normalized_name and a.location_ids <@ g.location_ids;
      if not found then raise exception 'Staff invitation link is invalid for %',a.canonical_name using errcode='55000'; end if;
    else
      select count(*),min(m.user_id::text)::uuid into n,staff_id from public.club_members m join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active and m.role in ('trainer','gym_staff','gym_admin','owner') and regexp_replace(lower(coalesce(nullif(btrim(p.first_name),''),split_part(btrim(coalesce(p.display_name,'')),' ',1))),'[^a-z]','','g')=a.normalized_name;
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
revoke all on function public.club_madhouse_seed_daily_checks(uuid) from public,anon;
grant execute on function public.club_madhouse_seed_daily_checks(uuid) to authenticated;
revoke all on function public.club_madhouse_generate_class_sessions(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_class_sessions(uuid,date,date) to authenticated;
revoke all on function public.club_madhouse_generate_rota(uuid,date,date) from public,anon;
grant execute on function public.club_madhouse_generate_rota(uuid,date,date) to authenticated;

commit;
