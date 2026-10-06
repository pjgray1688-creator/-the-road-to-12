-- R12 Club daily venue checks, equipment register and maintenance workflow.
-- This is a forward-only review artifact. It reuses staff.work_submit and
-- staff.work_review; no new permission is created by this feature.

create table if not exists public.club_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  name text not null,
  check_type text not null default 'daily' check (check_type in ('daily','opening','closing')),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id)
);

create table if not exists public.club_checklist_template_locations (
  template_id uuid not null references public.club_checklist_templates(id) on delete cascade,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key (template_id, location_id),
  foreign key (template_id, organisation_id) references public.club_checklist_templates(id, organisation_id),
  foreign key (organisation_id, location_id) references public.club_locations(organisation_id, id)
);

create table if not exists public.club_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.club_checklist_templates(id) on delete cascade,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  section text not null default 'Venue',
  label text not null,
  required boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id)
);

create table if not exists public.club_checklist_cycles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null,
  operational_date date not null,
  status text not null default 'open' check (status in ('open','submitted','reopened')),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, location_id, operational_date),
  foreign key (organisation_id, location_id) references public.club_locations(organisation_id, id)
);

create table if not exists public.club_checklist_item_checks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  cycle_id uuid not null references public.club_checklist_cycles(id) on delete cascade,
  item_id uuid not null,
  status text not null check (status in ('complete','issue','not_applicable')),
  note text,
  checked_by uuid not null references auth.users(id),
  checked_at timestamptz not null default now(),
  unique (cycle_id, item_id),
  foreign key (item_id, organisation_id) references public.club_checklist_items(id, organisation_id)
);

create table if not exists public.club_equipment_assets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null,
  name text not null,
  category text not null default 'General',
  manufacturer text,
  model text,
  serial_reference text,
  active boolean not null default true,
  check_frequency_days integer not null default 1 check (check_frequency_days > 0),
  operational_status text not null default 'operational' check (operational_status in ('operational','needs_attention','out_of_service','inactive')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (organisation_id, location_id) references public.club_locations(organisation_id, id)
);

create table if not exists public.club_equipment_checks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  cycle_id uuid not null references public.club_checklist_cycles(id) on delete cascade,
  asset_id uuid not null,
  status text not null check (status in ('ok','issue','out_of_service','not_present')),
  note text,
  media_reference text,
  checked_by uuid not null references auth.users(id),
  checked_at timestamptz not null default now(),
  unique (cycle_id, asset_id),
  foreign key (asset_id, organisation_id) references public.club_equipment_assets(id, organisation_id)
);

create table if not exists public.club_maintenance_issues (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null,
  asset_id uuid,
  cycle_id uuid references public.club_checklist_cycles(id) on delete set null,
  description text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'reported' check (status in ('reported','acknowledged','in_progress','awaiting_parts','resolved','closed')),
  out_of_service boolean not null default false,
  media_reference text,
  reported_by uuid not null references auth.users(id),
  reported_at timestamptz not null default now(),
  reviewer_user_id uuid references auth.users(id),
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organisation_id, location_id) references public.club_locations(organisation_id, id),
  foreign key (asset_id, organisation_id) references public.club_equipment_assets(id, organisation_id)
);

create table if not exists public.club_maintenance_issue_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  issue_id uuid not null references public.club_maintenance_issues(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists club_checklist_template_locations_location_idx on public.club_checklist_template_locations(organisation_id, location_id);
create index if not exists club_checklist_cycles_location_date_idx on public.club_checklist_cycles(organisation_id, location_id, operational_date desc);
create index if not exists club_equipment_assets_location_idx on public.club_equipment_assets(organisation_id, location_id, active);
create index if not exists club_maintenance_issues_open_idx on public.club_maintenance_issues(organisation_id, location_id, status);
create index if not exists club_maintenance_issue_history_issue_idx on public.club_maintenance_issue_history(issue_id, created_at desc);

alter table public.club_checklist_templates enable row level security;
alter table public.club_checklist_template_locations enable row level security;
alter table public.club_checklist_items enable row level security;
alter table public.club_checklist_cycles enable row level security;
alter table public.club_checklist_item_checks enable row level security;
alter table public.club_equipment_assets enable row level security;
alter table public.club_equipment_checks enable row level security;
alter table public.club_maintenance_issues enable row level security;
alter table public.club_maintenance_issue_history enable row level security;
revoke all on table public.club_checklist_templates, public.club_checklist_template_locations, public.club_checklist_items,
  public.club_checklist_cycles, public.club_checklist_item_checks, public.club_equipment_assets,
  public.club_equipment_checks, public.club_maintenance_issues, public.club_maintenance_issue_history
  from public, anon, authenticated;

create or replace function public.club_venue_operational_date(p_at timestamptz default now())
returns date language sql stable set search_path=pg_catalog as $$
  select (coalesce(p_at, now()) at time zone 'Europe/London')::date;
$$;

create or replace function public.club_venue_check_access(p_organisation_id uuid,p_location_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.club_capability_allowed(p_organisation_id,auth.uid(),p_capability)
    and public.club_location_authorized(p_organisation_id,p_location_id)
    and exists(select 1 from public.club_locations l where l.id=p_location_id and l.organisation_id=p_organisation_id and l.active);
$$;

create or replace function public.club_checklist_create_template(p_organisation_id uuid,p_name text,p_check_type text default 'daily')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_checklist_templates%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Checklist management is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or p_check_type not in ('daily','opening','closing') then raise exception 'Invalid checklist template' using errcode='22023'; end if;
  insert into public.club_checklist_templates(organisation_id,name,check_type,created_by) values(p_organisation_id,left(btrim(p_name),120),p_check_type,auth.uid()) returning * into r;
  perform public.club_append_audit_event(p_organisation_id,'venue.checklist_template_changed','checklist_template',r.id,null,null,jsonb_build_object('change','created','name',r.name,'check_type',r.check_type));
  return to_jsonb(r);
end; $$;

create or replace function public.club_checklist_assign_template(p_organisation_id uuid,p_template_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_checklist_template_locations%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Checklist management is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_checklist_templates where id=p_template_id and organisation_id=p_organisation_id and active) then raise exception 'Checklist template not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Venue is not in this organisation' using errcode='22023'; end if;
  insert into public.club_checklist_template_locations(template_id,organisation_id,location_id,assigned_by) values(p_template_id,p_organisation_id,p_location_id,auth.uid()) on conflict(template_id,location_id) do update set assigned_by=excluded.assigned_by,assigned_at=now() returning * into r;
  perform public.club_append_audit_event(p_organisation_id,'venue.checklist_template_changed','checklist_template',p_template_id,p_location_id,null,jsonb_build_object('change','assigned'));
  return to_jsonb(r);
end; $$;

create or replace function public.club_checklist_save_item(p_organisation_id uuid,p_template_id uuid,p_item_id uuid,p_section text,p_label text,p_required boolean default true,p_sort_order integer default 0,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_checklist_items%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Checklist management is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_checklist_templates where id=p_template_id and organisation_id=p_organisation_id) or nullif(btrim(p_label),'') is null or p_sort_order<0 then raise exception 'Invalid checklist item' using errcode='22023'; end if;
  if p_item_id is null then
    insert into public.club_checklist_items(template_id,organisation_id,section,label,required,sort_order,active,created_by) values(p_template_id,p_organisation_id,coalesce(nullif(btrim(p_section),''),'Venue'),left(btrim(p_label),180),p_required,p_sort_order,p_active,auth.uid()) returning * into r;
  else
    update public.club_checklist_items set section=coalesce(nullif(btrim(p_section),''),'Venue'),label=left(btrim(p_label),180),required=p_required,sort_order=p_sort_order,active=p_active,updated_at=now() where id=p_item_id and template_id=p_template_id and organisation_id=p_organisation_id returning * into r;
    if not found then raise exception 'Checklist item not found' using errcode='P0002'; end if;
  end if;
  perform public.club_append_audit_event(p_organisation_id,'venue.checklist_item_changed','checklist_item',r.id,null,null,jsonb_build_object('template_id',p_template_id,'label',r.label,'active',r.active));
  return to_jsonb(r);
end; $$;

create or replace function public.club_equipment_save_asset(p_organisation_id uuid,p_location_id uuid,p_asset_id uuid,p_name text,p_category text,p_manufacturer text default null,p_model text default null,p_serial_reference text default null,p_check_frequency_days integer default 1,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_equipment_assets%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Equipment management is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or nullif(btrim(p_name),'') is null or p_check_frequency_days<1 then raise exception 'Invalid equipment asset' using errcode='22023'; end if;
  if p_asset_id is null then
    insert into public.club_equipment_assets(organisation_id,location_id,name,category,manufacturer,model,serial_reference,check_frequency_days,active,created_by) values(p_organisation_id,p_location_id,left(btrim(p_name),160),coalesce(nullif(btrim(p_category),''),'General'),nullif(btrim(p_manufacturer),''),nullif(btrim(p_model),''),nullif(btrim(p_serial_reference),''),p_check_frequency_days,p_active,auth.uid()) returning * into r;
  else
    update public.club_equipment_assets set name=left(btrim(p_name),160),category=coalesce(nullif(btrim(p_category),''),'General'),manufacturer=nullif(btrim(p_manufacturer),''),model=nullif(btrim(p_model),''),serial_reference=nullif(btrim(p_serial_reference),''),check_frequency_days=p_check_frequency_days,active=p_active,updated_at=now() where id=p_asset_id and organisation_id=p_organisation_id and location_id=p_location_id returning * into r;
    if not found then raise exception 'Equipment asset not found' using errcode='P0002'; end if;
  end if;
  perform public.club_append_audit_event(p_organisation_id,'venue.equipment_changed','equipment_asset',r.id,p_location_id,null,jsonb_build_object('change',case when p_asset_id is null then 'created' else 'updated' end,'name',r.name,'active',r.active));
  return to_jsonb(r);
end; $$;

create or replace function public.club_get_venue_daily_checks(p_organisation_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare cycle public.club_checklist_cycles%rowtype; template_ids uuid[]; item_total integer; item_done integer; equipment_total integer; equipment_done integer; unresolved integer;
begin
  if auth.uid() is null or not public.club_location_authorized(p_organisation_id,p_location_id) or not (public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_submit') or public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review')) then raise exception 'Venue checks are not permitted' using errcode='42501'; end if;
  insert into public.club_checklist_cycles(organisation_id,location_id,operational_date) values(p_organisation_id,p_location_id,public.club_venue_operational_date()) on conflict(organisation_id,location_id,operational_date) do nothing;
  select * into cycle from public.club_checklist_cycles where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public.club_venue_operational_date();
  select coalesce(array_agg(distinct t.id),'{}') into template_ids from public.club_checklist_templates t join public.club_checklist_template_locations tl on tl.template_id=t.id and tl.location_id=p_location_id and tl.organisation_id=p_organisation_id where t.organisation_id=p_organisation_id and t.active and t.check_type='daily';
  select count(*) into item_total from public.club_checklist_items i where i.organisation_id=p_organisation_id and i.template_id=any(template_ids) and i.active and i.required;
  select count(*) into item_done from public.club_checklist_item_checks c join public.club_checklist_items i on i.id=c.item_id where c.cycle_id=cycle.id and c.status is not null and i.active and i.required;
  select count(*) into equipment_total from public.club_equipment_assets where organisation_id=p_organisation_id and location_id=p_location_id and active;
  select count(*) into equipment_done from public.club_equipment_checks c join public.club_equipment_assets a on a.id=c.asset_id where c.cycle_id=cycle.id and a.active;
  select count(*) into unresolved from public.club_maintenance_issues where organisation_id=p_organisation_id and location_id=p_location_id and status not in ('resolved','closed');
  return jsonb_build_object('cycle',to_jsonb(cycle)||jsonb_build_object('submitted_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=cycle.submitted_by),'Staff')),'item_total',item_total,'item_done',item_done,'equipment_total',equipment_total,'equipment_done',equipment_done,'total',item_total+equipment_total,'completed',item_done+equipment_done,'unresolved_issues',unresolved,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'section',i.section,'label',i.label,'required',i.required,'sort_order',i.sort_order,'status',c.status,'note',c.note,'checked_at',c.checked_at,'checked_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=c.checked_by),'Staff')) order by i.sort_order,i.label) from public.club_checklist_items i left join public.club_checklist_item_checks c on c.item_id=i.id and c.cycle_id=cycle.id where i.organisation_id=p_organisation_id and i.template_id=any(template_ids) and i.active),'[]'::jsonb),
    'equipment',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'category',a.category,'manufacturer',a.manufacturer,'model',a.model,'serial_reference',a.serial_reference,'operational_status',a.operational_status,'status',c.status,'note',c.note,'media_reference',c.media_reference,'checked_at',c.checked_at,'checked_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=c.checked_by),'Staff')) order by a.name) from public.club_equipment_assets a left join public.club_equipment_checks c on c.asset_id=a.id and c.cycle_id=cycle.id where a.organisation_id=p_organisation_id and a.location_id=p_location_id and a.active),'[]'::jsonb),
    'issues',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'priority',x.priority,'status',x.status,'out_of_service',x.out_of_service,'reported_at',x.reported_at,'reported_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=x.reported_by),'Staff'),'reviewer_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=x.reviewer_user_id),'Not reviewed'),'resolution_note',x.resolution_note,'history',coalesce((select jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'note',h.note,'created_at',h.created_at,'actor_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=h.actor_user_id),'Staff')) order by h.created_at) from public.club_maintenance_issue_history h where h.issue_id=x.id),'[]'::jsonb)) order by x.reported_at desc) from public.club_maintenance_issues x where x.organisation_id=p_organisation_id and x.location_id=p_location_id),'[]'::jsonb),
    'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'check_type',t.check_type,'active',t.active,'assigned',exists(select 1 from public.club_checklist_template_locations z where z.template_id=t.id and z.location_id=p_location_id)) order by t.name) from public.club_checklist_templates t where t.organisation_id=p_organisation_id),'[]'::jsonb));
end; $$;

create or replace function public.club_list_venue_check_overview(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('location_id',l.id,'location_name',l.name,'item_total',coalesce((select count(*) from public.club_checklist_items i join public.club_checklist_template_locations tl on tl.template_id=i.template_id and tl.location_id=l.id where i.organisation_id=p_organisation_id and i.active and i.required),0),'item_done',coalesce((select count(*) from public.club_checklist_item_checks c join public.club_checklist_cycles cy on cy.id=c.cycle_id join public.club_checklist_items i on i.id=c.item_id join public.club_checklist_template_locations tl on tl.template_id=i.template_id and tl.location_id=l.id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date() and i.active and i.required),0),'equipment_total',coalesce((select count(*) from public.club_equipment_assets a where a.organisation_id=p_organisation_id and a.location_id=l.id and a.active),0),'equipment_done',coalesce((select count(*) from public.club_equipment_checks c join public.club_checklist_cycles cy on cy.id=c.cycle_id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),0),'submitted',coalesce((select cy.status='submitted' from public.club_checklist_cycles cy where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),false),'submitted_by_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p join public.club_checklist_cycles cy on cy.submitted_by=p.id where cy.organisation_id=p_organisation_id and cy.location_id=l.id and cy.operational_date=public.club_venue_operational_date()),'Not submitted'),'unresolved_issues',coalesce((select count(*) from public.club_maintenance_issues x where x.organisation_id=p_organisation_id and x.location_id=l.id and x.status not in ('resolved','closed')),0)) order by l.name),'[]'::jsonb)
  from public.club_locations l where l.organisation_id=p_organisation_id and l.active and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review');
$$;

create or replace function public.club_record_checklist_item(p_organisation_id uuid,p_location_id uuid,p_item_id uuid,p_status text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare cycle public.club_checklist_cycles%rowtype; item public.club_checklist_items%rowtype; result public.club_checklist_item_checks%rowtype; existing_issue public.club_maintenance_issues%rowtype;
begin
  if auth.uid() is null or not public.club_venue_check_access(p_organisation_id,p_location_id,'staff.work_submit') then raise exception 'Venue checks are not permitted' using errcode='42501'; end if;
  if p_status not in ('complete','issue','not_applicable') then raise exception 'Invalid checklist status' using errcode='22023'; end if;
  select i.* into item from public.club_checklist_items i join public.club_checklist_templates t on t.id=i.template_id join public.club_checklist_template_locations tl on tl.template_id=t.id and tl.location_id=p_location_id where i.id=p_item_id and i.organisation_id=p_organisation_id and i.active and t.active and t.check_type='daily';
  if not found then raise exception 'Checklist item is not assigned to this venue' using errcode='42501'; end if;
  insert into public.club_checklist_cycles(organisation_id,location_id,operational_date) values(p_organisation_id,p_location_id,public.club_venue_operational_date()) on conflict(organisation_id,location_id,operational_date) do nothing;
  select * into cycle from public.club_checklist_cycles where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public.club_venue_operational_date() for update;
  if cycle.status='submitted' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Submitted checklist requires manager reopening' using errcode='42501'; end if;
  insert into public.club_checklist_item_checks(organisation_id,cycle_id,item_id,status,note,checked_by) values(p_organisation_id,cycle.id,item.id,p_status,nullif(btrim(p_note),''),auth.uid()) on conflict(cycle_id,item_id) do update set status=excluded.status,note=excluded.note,checked_by=excluded.checked_by,checked_at=now() returning * into result;
  if p_status='issue' then
    select * into existing_issue from public.club_maintenance_issues where organisation_id=p_organisation_id and location_id=p_location_id and cycle_id=cycle.id and asset_id is null and status not in ('resolved','closed') and description=left(btrim(coalesce(p_note,item.label)),500) limit 1;
    if not found then insert into public.club_maintenance_issues(organisation_id,location_id,cycle_id,description,priority,out_of_service,reported_by) values(p_organisation_id,p_location_id,cycle.id,left(btrim(coalesce(p_note,item.label)),500),'normal',false,auth.uid()); end if;
  end if;
  perform public.club_append_audit_event(p_organisation_id,'venue.checklist_item_changed','checklist_item',item.id,p_location_id,p_note,jsonb_build_object('status',p_status,'cycle_id',cycle.id));
  return to_jsonb(result);
end; $$;

create or replace function public.club_record_equipment_check(p_organisation_id uuid,p_location_id uuid,p_asset_id uuid,p_status text,p_note text default null,p_media_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare cycle public.club_checklist_cycles%rowtype; asset public.club_equipment_assets%rowtype; result public.club_equipment_checks%rowtype; issue public.club_maintenance_issues%rowtype;
begin
  if auth.uid() is null or not public.club_venue_check_access(p_organisation_id,p_location_id,'staff.work_submit') then raise exception 'Venue checks are not permitted' using errcode='42501'; end if;
  if p_status not in ('ok','issue','out_of_service','not_present') then raise exception 'Invalid equipment status' using errcode='22023'; end if;
  select * into asset from public.club_equipment_assets where id=p_asset_id and organisation_id=p_organisation_id and location_id=p_location_id and active;
  if not found then raise exception 'Equipment asset is not available at this venue' using errcode='42501'; end if;
  insert into public.club_checklist_cycles(organisation_id,location_id,operational_date) values(p_organisation_id,p_location_id,public.club_venue_operational_date()) on conflict(organisation_id,location_id,operational_date) do nothing;
  select * into cycle from public.club_checklist_cycles where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public.club_venue_operational_date() for update;
  if cycle.status='submitted' and not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Submitted checklist requires manager reopening' using errcode='42501'; end if;
  insert into public.club_equipment_checks(organisation_id,cycle_id,asset_id,status,note,media_reference,checked_by) values(p_organisation_id,cycle.id,asset.id,p_status,nullif(btrim(p_note),''),nullif(btrim(p_media_reference),''),auth.uid()) on conflict(cycle_id,asset_id) do update set status=excluded.status,note=excluded.note,media_reference=excluded.media_reference,checked_by=excluded.checked_by,checked_at=now() returning * into result;
  if p_status in ('issue','out_of_service') then
    select * into issue from public.club_maintenance_issues where organisation_id=p_organisation_id and asset_id=asset.id and status not in ('resolved','closed') order by reported_at desc limit 1;
    if found then update public.club_maintenance_issues set out_of_service=out_of_service or p_status='out_of_service',cycle_id=cycle.id,updated_at=now() where id=issue.id; else insert into public.club_maintenance_issues(organisation_id,location_id,asset_id,cycle_id,description,priority,out_of_service,reported_by) values(p_organisation_id,p_location_id,asset.id,cycle.id,left(coalesce(nullif(btrim(p_note),''),asset.name||' needs attention'),500),case when p_status='out_of_service' then 'high' else 'normal' end,p_status='out_of_service',auth.uid()); end if;
    update public.club_equipment_assets set operational_status=case when p_status='out_of_service' then 'out_of_service' else 'needs_attention' end,updated_at=now() where id=asset.id;
  end if;
  perform public.club_append_audit_event(p_organisation_id,case when p_status='out_of_service' then 'venue.equipment_marked_out_of_service' else 'venue.equipment_status_recorded' end,'equipment_asset',asset.id,p_location_id,p_note,jsonb_build_object('status',p_status,'cycle_id',cycle.id,'media_reference',nullif(btrim(p_media_reference),'')));
  return to_jsonb(result);
end; $$;

create or replace function public.club_report_maintenance_issue(p_organisation_id uuid,p_location_id uuid,p_asset_id uuid,p_description text,p_priority text default 'normal',p_out_of_service boolean default false,p_media_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_maintenance_issues%rowtype;
begin
  if auth.uid() is null or not public.club_venue_check_access(p_organisation_id,p_location_id,'staff.work_submit') then raise exception 'Maintenance reporting is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_description),'') is null or p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid maintenance report' using errcode='22023'; end if;
  if p_asset_id is not null and not exists(select 1 from public.club_equipment_assets where id=p_asset_id and organisation_id=p_organisation_id and location_id=p_location_id) then raise exception 'Equipment is not in this venue' using errcode='22023'; end if;
  insert into public.club_maintenance_issues(organisation_id,location_id,asset_id,description,priority,out_of_service,media_reference,reported_by) values(p_organisation_id,p_location_id,p_asset_id,left(btrim(p_description),500),p_priority,p_out_of_service,nullif(btrim(p_media_reference),''),auth.uid()) returning * into r;
  if p_out_of_service and p_asset_id is not null then update public.club_equipment_assets set operational_status='out_of_service',updated_at=now() where id=p_asset_id; end if;
  perform public.club_append_audit_event(p_organisation_id,case when p_out_of_service then 'venue.equipment_marked_out_of_service' else 'venue.fault_reported' end,'maintenance_issue',r.id,p_location_id,null,jsonb_build_object('asset_id',p_asset_id,'priority',p_priority,'out_of_service',p_out_of_service,'media_reference',nullif(btrim(p_media_reference),'')));
  return to_jsonb(r);
end; $$;

create or replace function public.club_set_maintenance_status(p_organisation_id uuid,p_issue_id uuid,p_status text,p_note text default null,p_return_to_service boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_maintenance_issues%rowtype; previous text; still_out boolean;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.work_review') then raise exception 'Maintenance review is not permitted' using errcode='42501'; end if;
  if p_status not in ('reported','acknowledged','in_progress','awaiting_parts','resolved','closed') then raise exception 'Invalid maintenance status' using errcode='22023'; end if;
  select * into r from public.club_maintenance_issues where id=p_issue_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Maintenance issue not found' using errcode='P0002'; end if;
  previous:=r.status;
  update public.club_maintenance_issues set status=p_status,reviewer_user_id=auth.uid(),resolution_note=case when p_status in ('resolved','closed') then nullif(btrim(p_note),'') else resolution_note end,resolved_by=case when p_status='resolved' then auth.uid() else resolved_by end,resolved_at=case when p_status='resolved' then now() else resolved_at end,closed_by=case when p_status='closed' then auth.uid() else closed_by end,closed_at=case when p_status='closed' then now() else closed_at end,updated_at=now() where id=r.id returning * into r;
  insert into public.club_maintenance_issue_history(organisation_id,issue_id,actor_user_id,from_status,to_status,note) values(p_organisation_id,r.id,auth.uid(),previous,p_status,nullif(btrim(p_note),''));
  perform public.club_append_audit_event(p_organisation_id,case when p_status in ('resolved','closed') then 'venue.fault_resolved' else 'venue.fault_status_changed' end,'maintenance_issue',r.id,r.location_id,p_note,jsonb_build_object('from',previous,'to',p_status));
  if p_return_to_service and p_status in ('resolved','closed') and r.asset_id is not null then
    select exists(select 1 from public.club_maintenance_issues where organisation_id=p_organisation_id and asset_id=r.asset_id and status not in ('resolved','closed') and id<>r.id) into still_out;
    if not still_out then update public.club_equipment_assets set operational_status='operational',updated_at=now() where id=r.asset_id; perform public.club_append_audit_event(p_organisation_id,'venue.equipment_returned_to_service','equipment_asset',r.asset_id,r.location_id,p_note,jsonb_build_object('issue_id',r.id)); end if;
  end if;
  return to_jsonb(r);
end; $$;

create or replace function public.club_reopen_daily_check(p_organisation_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_checklist_cycles%rowtype;
begin
  if auth.uid() is null or not public.club_venue_check_access(p_organisation_id,p_location_id,'staff.work_review') then raise exception 'Checklist review is not permitted' using errcode='42501'; end if;
  update public.club_checklist_cycles set status='reopened',reopened_by=auth.uid(),reopened_at=now(),updated_at=now() where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public.club_venue_operational_date() and status='submitted' returning * into r;
  if not found then raise exception 'No submitted checklist is available to reopen' using errcode='P0002'; end if;
  perform public.club_append_audit_event(p_organisation_id,'venue.checklist_reopened','checklist_cycle',r.id,p_location_id,null,jsonb_build_object('operational_date',r.operational_date));
  return to_jsonb(r);
end; $$;

create or replace function public.club_submit_daily_check(p_organisation_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare cycle public.club_checklist_cycles%rowtype; item_total integer; item_done integer; equipment_total integer; equipment_done integer;
begin
  if auth.uid() is null or not public.club_venue_check_access(p_organisation_id,p_location_id,'staff.work_submit') then raise exception 'Venue checks are not permitted' using errcode='42501'; end if;
  insert into public.club_checklist_cycles(organisation_id,location_id,operational_date) values(p_organisation_id,p_location_id,public.club_venue_operational_date()) on conflict(organisation_id,location_id,operational_date) do nothing;
  select * into cycle from public.club_checklist_cycles where organisation_id=p_organisation_id and location_id=p_location_id and operational_date=public.club_venue_operational_date() for update;
  if cycle.status='submitted' then return to_jsonb(cycle); end if;
  select count(*) into item_total from public.club_checklist_items i where i.organisation_id=p_organisation_id and i.active and i.required and exists(select 1 from public.club_checklist_template_locations tl join public.club_checklist_templates t on t.id=tl.template_id and t.active and t.check_type='daily' where tl.template_id=i.template_id and tl.location_id=p_location_id);
  select count(*) into item_done from public.club_checklist_item_checks c join public.club_checklist_items i on i.id=c.item_id where c.cycle_id=cycle.id and i.active and i.required;
  select count(*) into equipment_total from public.club_equipment_assets where organisation_id=p_organisation_id and location_id=p_location_id and active;
  select count(*) into equipment_done from public.club_equipment_checks c join public.club_equipment_assets a on a.id=c.asset_id where c.cycle_id=cycle.id and a.active;
  if item_done<item_total or equipment_done<equipment_total then raise exception 'Complete every daily check before submitting (% of % complete)',item_done+equipment_done,item_total+equipment_total using errcode='22023'; end if;
  update public.club_checklist_cycles set status='submitted',submitted_by=auth.uid(),submitted_at=now(),updated_at=now() where id=cycle.id returning * into cycle;
  perform public.club_append_audit_event(p_organisation_id,'venue.checklist_submitted','checklist_cycle',cycle.id,p_location_id,null,jsonb_build_object('completed',item_done+equipment_done,'total',item_total+equipment_total,'operational_date',cycle.operational_date));
  return to_jsonb(cycle);
end; $$;

revoke all on function public.club_venue_operational_date(timestamptz),public.club_venue_check_access(uuid,uuid,text) from public,anon;
revoke all on function public.club_checklist_create_template(uuid,text,text),public.club_checklist_assign_template(uuid,uuid,uuid),public.club_checklist_save_item(uuid,uuid,uuid,text,text,boolean,integer,boolean),public.club_equipment_save_asset(uuid,uuid,uuid,text,text,text,text,text,integer,boolean) from public,anon;
revoke all on function public.club_get_venue_daily_checks(uuid,uuid),public.club_list_venue_check_overview(uuid),public.club_record_checklist_item(uuid,uuid,uuid,text,text),public.club_record_equipment_check(uuid,uuid,uuid,text,text,text),public.club_report_maintenance_issue(uuid,uuid,uuid,text,text,boolean,text),public.club_set_maintenance_status(uuid,uuid,text,text,boolean),public.club_reopen_daily_check(uuid,uuid),public.club_submit_daily_check(uuid,uuid) from public,anon;
grant execute on function public.club_venue_operational_date(timestamptz),public.club_venue_check_access(uuid,uuid,text) to authenticated;
grant execute on function public.club_checklist_create_template(uuid,text,text),public.club_checklist_assign_template(uuid,uuid,uuid),public.club_checklist_save_item(uuid,uuid,uuid,text,text,boolean,integer,boolean),public.club_equipment_save_asset(uuid,uuid,uuid,text,text,text,text,text,integer,boolean) to authenticated;
grant execute on function public.club_get_venue_daily_checks(uuid,uuid),public.club_list_venue_check_overview(uuid),public.club_record_checklist_item(uuid,uuid,uuid,text,text),public.club_record_equipment_check(uuid,uuid,uuid,text,text,text),public.club_report_maintenance_issue(uuid,uuid,uuid,text,text,boolean,text),public.club_set_maintenance_status(uuid,uuid,text,text,boolean),public.club_reopen_daily_check(uuid,uuid),public.club_submit_daily_check(uuid,uuid) to authenticated;
