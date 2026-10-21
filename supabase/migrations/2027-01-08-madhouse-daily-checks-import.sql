-- Madhouse cleaning tasks use the existing Club checklists, cycles and staff
-- completion history. Seeding is a management RPC so the real actor is audited.
alter table public.club_checklist_templates add column if not exists source_key text;
alter table public.club_checklist_template_locations alter column assigned_by drop not null;
alter table public.club_checklist_items add column if not exists source_key text;
alter table public.club_checklist_items add column if not exists scheduled_weekday smallint check(scheduled_weekday between 1 and 7);
alter table public.club_checklist_templates alter column created_by drop not null;
alter table public.club_checklist_items alter column created_by drop not null;
create unique index if not exists club_checklist_template_source_key_uq on public.club_checklist_templates(organisation_id,source_key) where source_key is not null;
create unique index if not exists club_checklist_item_source_key_uq on public.club_checklist_items(template_id,source_key) where source_key is not null;

create or replace function public.club_madhouse_seed_daily_checks(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare actor_role text; loc record; template_id uuid; item record; inserted integer:=0; location_id uuid; matches integer;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Daily check setup is restricted to authorised management' using errcode='42501'; end if;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  for loc in select * from (values('Rotherham','Rotherham'),('Carlton','Carlton')) as x(location_key,location_name) loop
    select count(*),min(l.id::text)::uuid into matches,location_id from public.club_locations l where l.organisation_id=p_organisation_id and l.active and lower(btrim(l.name))=lower(loc.location_name);
    if matches<>1 then raise exception 'Daily checks require exactly one active % location',loc.location_name using errcode='55000'; end if;
    insert into public.club_checklist_templates(organisation_id,name,check_type,active,created_by,source_key)
      values(p_organisation_id,'Madhouse daily checks · '||loc.location_name,'daily',true,auth.uid(),'madhouse-daily-'||lower(loc.location_key))
      on conflict(organisation_id,source_key) where source_key is not null do update set name=excluded.name,check_type='daily',active=true,updated_at=now() returning id into template_id;
    insert into public.club_checklist_template_locations(template_id,organisation_id,location_id,assigned_by)
      values(template_id,p_organisation_id,location_id,auth.uid()) on conflict(template_id,location_id) do nothing;
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
        values(template_id,p_organisation_id,item.section,item.label,true,case when item.weekday is null then 10 else 20+item.weekday end,true,auth.uid(),item.item_key,item.weekday)
        on conflict(template_id,source_key) where source_key is not null do update set section=excluded.section,label=excluded.label,required=true,sort_order=excluded.sort_order,active=true,scheduled_weekday=excluded.scheduled_weekday,updated_at=now();
      inserted:=inserted+1;
    end loop;
    perform public.club_append_audit_event(p_organisation_id,'venue.madhouse_checks_seeded','checklist_template',template_id,location_id,null,jsonb_build_object('source','madhouse-weekly-checks','actor_role',actor_role));
  end loop;
  return jsonb_build_object('templates',2,'items',inserted,'locations',2);
end; $$;
revoke all on function public.club_madhouse_seed_daily_checks(uuid) from public,anon;
grant execute on function public.club_madhouse_seed_daily_checks(uuid) to authenticated;

create or replace function public.club_validate_madhouse_check_weekday()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare weekday_due smallint; check_date date;
begin
  select i.scheduled_weekday,cy.operational_date into weekday_due,check_date from public.club_checklist_items i join public.club_checklist_cycles cy on cy.id=new.cycle_id and cy.organisation_id=new.organisation_id where i.id=new.item_id and i.organisation_id=new.organisation_id;
  if weekday_due is not null and weekday_due<>extract(isodow from check_date)::smallint then raise exception 'This scheduled check is not due today' using errcode='22023'; end if;
  return new;
end; $$;
drop trigger if exists club_madhouse_check_weekday_guard on public.club_checklist_item_checks;
create trigger club_madhouse_check_weekday_guard before insert or update of cycle_id,item_id on public.club_checklist_item_checks for each row execute function public.club_validate_madhouse_check_weekday();

create or replace function public.club_get_venue_daily_checks(p_organisation_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare cycle public.club_checklist_cycles%rowtype; template_ids uuid[]; item_total integer; item_done integer; equipment_total integer; equipment_done integer; unresolved integer;
begin
  if auth.uid() is null or not public.club_location_authorized(p_organisation_id,p_location_id) or not (public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_submit') or public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review')) then raise exception 'Venue checks are not permitted' using errcode='42501'; end if;
  insert into public.club_checklist_cycles(organisation_id,location_id,operational_date) values(p_organisation_id,p_location_id,public.club_venue_operational_date()) on conflict(organisation_id,location_id,operational_date) do nothing;
  select * into cycle from public.club_checklist_cycles where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public.club_venue_operational_date();
  select coalesce(array_agg(distinct t.id),'{}') into template_ids from public.club_checklist_templates t join public.club_checklist_template_locations tl on tl.template_id=t.id and tl.location_id=p_location_id and tl.organisation_id=p_organisation_id where t.organisation_id=p_organisation_id and t.active and t.check_type='daily';
  select count(*) into item_total from public.club_checklist_items i where i.organisation_id=p_organisation_id and i.template_id=any(template_ids) and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from cycle.operational_date));
  select count(*) into item_done from public.club_checklist_item_checks c join public.club_checklist_items i on i.id=c.item_id where c.cycle_id=cycle.id and c.status is not null and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from cycle.operational_date));
  select count(*) into equipment_total from public.club_equipment_assets where organisation_id=p_organisation_id and location_id=p_location_id and active;
  select count(*) into equipment_done from public.club_equipment_checks c join public.club_equipment_assets a on a.id=c.asset_id where c.cycle_id=cycle.id and a.active;
  select count(*) into unresolved from public.club_maintenance_issues where organisation_id=p_organisation_id and location_id=p_location_id and status not in ('resolved','closed');
  return jsonb_build_object('cycle',to_jsonb(cycle)||jsonb_build_object('submitted_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=cycle.submitted_by),'Staff')),'item_total',item_total,'item_done',item_done,'equipment_total',equipment_total,'equipment_done',equipment_done,'total',item_total+equipment_total,'completed',item_done+equipment_done,'unresolved_issues',unresolved,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'section',i.section,'label',i.label,'required',i.required,'sort_order',i.sort_order,'status',c.status,'note',c.note,'checked_at',c.checked_at,'checked_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=c.checked_by),'Staff')) order by i.sort_order,i.label) from public.club_checklist_items i left join public.club_checklist_item_checks c on c.item_id=i.id and c.cycle_id=cycle.id where i.organisation_id=p_organisation_id and i.template_id=any(template_ids) and i.active and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from cycle.operational_date))),'[]'::jsonb),
    'equipment',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'category',a.category,'manufacturer',a.manufacturer,'model',a.model,'serial_reference',a.serial_reference,'operational_status',a.operational_status,'status',c.status,'note',c.note,'media_reference',c.media_reference,'checked_at',c.checked_at,'checked_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=c.checked_by),'Staff')) order by a.name) from public.club_equipment_assets a left join public.club_equipment_checks c on c.asset_id=a.id and c.cycle_id=cycle.id where a.organisation_id=p_organisation_id and a.location_id=p_location_id and a.active),'[]'::jsonb),
    'issues',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'priority',x.priority,'status',x.status,'out_of_service',x.out_of_service,'reported_at',x.reported_at,'reported_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=x.reported_by),'Staff'),'reviewer_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=x.reviewer_user_id),'Not reviewed'),'resolution_note',x.resolution_note,'history',coalesce((select jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'note',h.note,'created_at',h.created_at,'actor_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=h.actor_user_id),'Staff')) order by h.created_at) from public.club_maintenance_issue_history h where h.issue_id=x.id),'[]'::jsonb)) order by x.reported_at desc) from public.club_maintenance_issues x where x.organisation_id=p_organisation_id and x.location_id=p_location_id),'[]'::jsonb),
    'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'check_type',t.check_type,'active',t.active,'assigned',exists(select 1 from public.club_checklist_template_locations z where z.template_id=t.id and z.location_id=p_location_id)) order by t.name) from public.club_checklist_templates t where t.organisation_id=p_organisation_id),'[]'::jsonb));
end; $$;
revoke all on function public.club_get_venue_daily_checks(uuid,uuid),public.club_validate_madhouse_check_weekday() from public,anon;
grant execute on function public.club_get_venue_daily_checks(uuid,uuid) to authenticated;

create or replace function public.club_list_venue_check_overview(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('location_id',l.id,'location_name',l.name,'item_total',coalesce((select count(*) from public.club_checklist_items i join public.club_checklist_template_locations tl on tl.template_id=i.template_id and tl.location_id=l.id where i.organisation_id=p_organisation_id and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from public.club_venue_operational_date()))),0),'item_done',coalesce((select count(*) from public.club_checklist_item_checks c join public.club_checklist_cycles cy on cy.id=c.cycle_id join public.club_checklist_items i on i.id=c.item_id join public.club_checklist_template_locations tl on tl.template_id=i.template_id and tl.location_id=l.id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date() and i.active and i.required and (i.scheduled_weekday is null or i.scheduled_weekday=extract(isodow from public.club_venue_operational_date()))),0),'equipment_total',coalesce((select count(*) from public.club_equipment_assets a where a.organisation_id=p_organisation_id and a.location_id=l.id and a.active),0),'equipment_done',coalesce((select count(*) from public.club_equipment_checks c join public.club_checklist_cycles cy on cy.id=c.cycle_id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),0),'submitted',coalesce((select cy.status='submitted' from public.club_checklist_cycles cy where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),false),'submitted_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p join public.club_checklist_cycles cy on cy.submitted_by=p.id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),'Not submitted'),'unresolved_issues',coalesce((select count(*) from public.club_maintenance_issues x where x.organisation_id=p_organisation_id and x.location_id=l.id and x.status not in ('resolved','closed')),0)) order by l.name),'[]'::jsonb)
  from public.club_locations l where l.organisation_id=p_organisation_id and l.active and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review');
$$;

revoke all on function public.club_list_venue_check_overview(uuid) from public,anon;
grant execute on function public.club_list_venue_check_overview(uuid) to authenticated;
