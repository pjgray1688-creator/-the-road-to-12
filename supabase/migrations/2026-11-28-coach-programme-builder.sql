-- Persistent programme/block history. profiles.generated_programme remains the
-- Member execution projection; these tables are the Coach source of truth.
alter table public.profiles add column if not exists active_programme_id text;

create table if not exists public.coach_programmes (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users(id) on delete cascade,
  owner_coach_user_id uuid not null references auth.users(id),
  organisation_id uuid references public.club_organisations(id) on delete cascade,
  relationship_id uuid references public.coach_relationships(id) on delete restrict,
  assignment_id uuid references public.coach_client_assignments(id) on delete restrict,
  title text not null,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((organisation_id is null and relationship_id is not null and assignment_id is null)
      or (organisation_id is not null and assignment_id is not null and relationship_id is null))
);

create table if not exists public.coach_programme_blocks (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.coach_programmes(id) on delete cascade,
  title text not null,
  description text,
  coach_notes text,
  ordinal integer not null default 1 check (ordinal > 0),
  status text not null default 'draft' check (status in ('draft','active','completed','archived')),
  start_date date,
  planned_weeks integer check (planned_weeks is null or planned_weeks between 1 and 104),
  target_end_date date,
  definition jsonb not null default '{"week":[]}'::jsonb,
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_programme_block_revisions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.coach_programme_blocks(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  definition jsonb not null,
  change_note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (block_id, revision_number)
);

create unique index if not exists coach_programmes_context_key
  on public.coach_programmes (client_user_id, owner_coach_user_id, (coalesce(organisation_id,'00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(relationship_id,'00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(assignment_id,'00000000-0000-0000-0000-000000000000'::uuid)));
create unique index if not exists coach_programme_blocks_one_active
  on public.coach_programme_blocks (programme_id) where status='active';
create unique index if not exists coach_programme_blocks_ordinal
  on public.coach_programme_blocks (programme_id, ordinal);
create index if not exists coach_programme_blocks_programme_idx on public.coach_programme_blocks (programme_id, status, ordinal);
create index if not exists coach_programme_revisions_block_idx on public.coach_programme_block_revisions (block_id, revision_number desc);

create or replace function public.coach_programme_revision_immutable()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception 'Programme revisions are immutable' using errcode='42501';
end; $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid='public.coach_programme_block_revisions'::regclass and tgname='coach_programme_revisions_immutable') then
    create trigger coach_programme_revisions_immutable before update or delete on public.coach_programme_block_revisions for each row execute function public.coach_programme_revision_immutable();
  end if;
end $$;

alter table public.coach_programmes enable row level security;
alter table public.coach_programme_blocks enable row level security;
alter table public.coach_programme_block_revisions enable row level security;
revoke all on public.coach_programmes, public.coach_programme_blocks, public.coach_programme_block_revisions from public, anon, authenticated;

create or replace function public.coach_resolve_programme_context(
  p_client_user_id uuid, p_organisation_id uuid, p_assignment_id uuid, p_relationship_id uuid, p_write boolean default false
) returns table (
  programme_id uuid,
  programme_owner_user_id uuid,
  primary_relationship_id uuid,
  primary_assignment_id uuid,
  caller_relationship_type text,
  resolved_organisation_id uuid
) language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_relationship public.coach_relationships%rowtype; v_assignment public.coach_client_assignments%rowtype; v_primary public.coach_relationships%rowtype; v_primary_assignment public.coach_client_assignments%rowtype; v_owner uuid; v_primary_count integer; begin
  if auth.uid() is null or p_client_user_id is null then return; end if;
  if p_organisation_id is null then
    if p_relationship_id is null then return; end if;
    select r.* into v_relationship from public.coach_relationships r where r.id=p_relationship_id and r.coach_user_id=auth.uid() and r.client_user_id=p_client_user_id and r.status='active' and r.relationship_type in ('primary','cover') and public.coach_has_explicit_access(auth.uid());
    if not found then return; end if;
    v_owner:=v_relationship.programme_owner_user_id;
    if v_relationship.relationship_type='primary' then
      v_primary:=v_relationship;
    elsif v_owner is null then
      select count(*) into v_primary_count from public.coach_relationships r where r.client_user_id=p_client_user_id and r.relationship_type='primary' and r.status='active';
      if v_primary_count<>1 then return; end if;
      select r.* into v_primary from public.coach_relationships r where r.client_user_id=p_client_user_id and r.relationship_type='primary' and r.status='active' order by r.created_at asc limit 1;
      if found then v_owner:=v_primary.programme_owner_user_id; end if;
    else
      select r.* into v_primary from public.coach_relationships r where r.client_user_id=p_client_user_id and r.relationship_type='primary' and r.status='active' and r.programme_owner_user_id=v_owner order by r.created_at asc limit 1;
    end if;
    if v_owner is null or v_primary.id is null or (p_write and (v_relationship.relationship_type<>'primary' or v_owner<>auth.uid())) then return; end if;
    return query select p.id,v_owner,v_primary.id,null::uuid,v_relationship.relationship_type,null::uuid from public.coach_programmes p where p.client_user_id=p_client_user_id and p.owner_coach_user_id=v_owner and p.organisation_id is null and p.relationship_id=v_primary.id order by p.updated_at desc limit 1;
    if not found then return query select null::uuid,v_owner,v_primary.id,null::uuid,v_relationship.relationship_type,null::uuid; end if;
    return;
  end if;
  if p_assignment_id is null then return; end if;
  select a.* into v_assignment from public.coach_client_assignments a join public.coach_permissions permission on permission.organisation_id=a.organisation_id and permission.user_id=auth.uid() and permission.active join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner') where a.id=p_assignment_id and a.organisation_id=p_organisation_id and a.coach_user_id=auth.uid() and a.client_user_id=p_client_user_id and a.active and a.relationship_type in ('primary','cover');
  if not found then return; end if;
  v_owner:=v_assignment.programme_owner_user_id;
  if v_assignment.relationship_type='primary' then v_primary_assignment:=v_assignment;
  else select a.* into v_primary_assignment from public.coach_client_assignments a where a.organisation_id=p_organisation_id and a.client_user_id=p_client_user_id and a.relationship_type='primary' and a.active and a.programme_owner_user_id=v_owner order by a.created_at asc limit 1; end if;
  if v_owner is null or v_primary_assignment.id is null or (p_write and (v_assignment.relationship_type<>'primary' or v_owner<>auth.uid())) then return; end if;
  return query select p.id,v_owner,null::uuid,v_primary_assignment.id,v_assignment.relationship_type,p_organisation_id from public.coach_programmes p where p.client_user_id=p_client_user_id and p.owner_coach_user_id=v_owner and p.organisation_id=p_organisation_id and p.assignment_id=v_primary_assignment.id order by p.updated_at desc limit 1;
  if not found then return query select null::uuid,v_owner,null::uuid,v_primary_assignment.id,v_assignment.relationship_type,p_organisation_id; end if;
end; $$;

create or replace function public.coach_validate_block_definition(p_definition jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,public as $$
declare s jsonb; e jsonb; o jsonb; k text; n integer:=0; e_n integer; o_n integer; begin
  if p_definition is null or jsonb_typeof(p_definition) is distinct from 'object' then raise exception 'Block definition must be an object' using errcode='22023'; end if;
  if jsonb_typeof(p_definition->'id') is distinct from 'string' or nullif(btrim(p_definition->>'id'),'') is null or length(p_definition->>'id')>160 then raise exception 'Block definition id is invalid' using errcode='22023'; end if;
  if jsonb_typeof(p_definition->'name') is distinct from 'string' or nullif(btrim(p_definition->>'name'),'') is null or length(p_definition->>'name')>240 then raise exception 'Block definition name is invalid' using errcode='22023'; end if;
  if octet_length(p_definition::text)>500000 then raise exception 'Block definition is too large' using errcode='22023'; end if;
  if jsonb_typeof(p_definition->'week') is distinct from 'array' then raise exception 'Block week must be an array' using errcode='22023'; end if;
  if jsonb_array_length(p_definition->'week')>30 then raise exception 'Block has too many sessions' using errcode='22023'; end if;
  for s in select value from jsonb_array_elements(p_definition->'week') loop
    n:=n+1;
    if jsonb_typeof(s) is distinct from 'object' then raise exception 'Block session % must be an object',n using errcode='22023'; end if;
    if jsonb_typeof(s->'id') is distinct from 'string' or nullif(btrim(s->>'id'),'') is null or length(s->>'id')>160 then raise exception 'Block session % id is invalid',n using errcode='22023'; end if;
    if jsonb_typeof(s->'name') is distinct from 'string' or nullif(btrim(s->>'name'),'') is null or length(s->>'name')>240 then raise exception 'Block session % name is invalid',n using errcode='22023'; end if;
    if jsonb_typeof(s->'day') is distinct from 'number' then raise exception 'Block session % day is invalid',n using errcode='22023'; end if;
    if not coalesce(s->>'day'~'^[1-9][0-9]{0,2}$',false) then raise exception 'Block session % day is invalid',n using errcode='22023'; end if;
    if (s->>'day')::integer>365 then raise exception 'Block session % day is invalid',n using errcode='22023'; end if;
    if jsonb_typeof(s->'status') is distinct from 'string' or (s->>'status') not in ('planned','completed','partial','missed','rest','recovery_rest','rescheduled','unplanned_activity','illness_injury','other') then raise exception 'Block session % status is invalid',n using errcode='22023'; end if;
    if jsonb_typeof(s->'exerciseIds') is distinct from 'array' then raise exception 'Block session % exercises must be an array',n using errcode='22023'; end if;
    if jsonb_array_length(s->'exerciseIds')>100 then raise exception 'Block session % has too many exercises',n using errcode='22023'; end if;
    e_n:=0; for e in select value from jsonb_array_elements(s->'exerciseIds') loop e_n:=e_n+1; if jsonb_typeof(e) is distinct from 'string' or nullif(btrim(e#>>'{}'),'') is null or length(e#>>'{}')>160 then raise exception 'Block session % exercise % is invalid',n,e_n using errcode='22023'; end if; end loop;
    if s ? 'exerciseOverrides' then
      o:=s->'exerciseOverrides'; if jsonb_typeof(o) is distinct from 'object' then raise exception 'Block session % overrides must be an object',n using errcode='22023'; end if;
      select count(*) into o_n from jsonb_object_keys(o); if o_n>100 then raise exception 'Block session % has too many overrides',n using errcode='22023'; end if;
      for k,e in select key,value from jsonb_each(o) loop
        if nullif(btrim(k),'') is null or length(k)>160 or jsonb_typeof(e) is distinct from 'object' then raise exception 'Block session % override is invalid',n using errcode='22023'; end if;
        if e ? 'sets' and (jsonb_typeof(e->'sets') is distinct from 'number' or not coalesce(e->>'sets'~'^[1-9][0-9]{0,2}$',false)) then raise exception 'Block session % override sets is invalid',n using errcode='22023'; end if;
        if e ? 'target' and (jsonb_typeof(e->'target') is distinct from 'string' or length(e->>'target')>500) then raise exception 'Block session % override target is invalid',n using errcode='22023'; end if;
        if e ? 'name' and (jsonb_typeof(e->'name') is distinct from 'string' or length(e->>'name')>240) then raise exception 'Block session % override name is invalid',n using errcode='22023'; end if;
        if e ? 'notes' and (jsonb_typeof(e->'notes') is distinct from 'string' or length(e->>'notes')>2000) then raise exception 'Block session % override notes is invalid',n using errcode='22023'; end if;
      end loop;
    end if;
  end loop;
end; $$;

create or replace function public.coach_list_programme_blocks(p_client_user_id uuid, p_organisation_id uuid, p_assignment_id uuid, p_relationship_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context record; v_programme public.coach_programmes%rowtype; v_generated jsonb; v_blocks jsonb; begin
  select * into v_context from public.coach_resolve_programme_context(p_client_user_id,p_organisation_id,p_assignment_id,p_relationship_id,false);
  if not found then raise exception 'Coach client access denied' using errcode='42501'; end if;
  if v_context.programme_id is not null then select * into v_programme from public.coach_programmes where id=v_context.programme_id; end if;
  select generated_programme into v_generated from public.profiles where id=p_client_user_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'title',b.title,'description',b.description,'coachNotes',b.coach_notes,'ordinal',b.ordinal,'status',b.status,'startDate',b.start_date,'plannedWeeks',b.planned_weeks,'targetEndDate',b.target_end_date,'definition',b.definition,'activatedAt',b.activated_at,'completedAt',b.completed_at,'updatedAt',b.updated_at) order by b.ordinal), '[]'::jsonb) into v_blocks from public.coach_programme_blocks b where b.programme_id=v_context.programme_id;
  return jsonb_build_object('programme',case when v_programme.id is null then null else jsonb_build_object('id',v_programme.id,'title',v_programme.title,'status',v_programme.status) end,'blocks',v_blocks,'legacyProgramme',v_generated);
end; $$;

create or replace function public.coach_create_programme_block(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid,p_relationship_id uuid,p_title text,p_planned_weeks integer,p_definition jsonb,p_description text default null,p_coach_notes text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context record; v_programme public.coach_programmes%rowtype; v_block public.coach_programme_blocks%rowtype; v_id uuid:=gen_random_uuid(); v_definition jsonb; begin
  select * into v_context from public.coach_resolve_programme_context(p_client_user_id,p_organisation_id,p_assignment_id,p_relationship_id,true);
  if not found then raise exception 'Only the Primary PT can manage programme blocks' using errcode='42501'; end if;
  if p_title is null or nullif(btrim(p_title),'') is null or length(p_title)>240 then raise exception 'Block title is invalid' using errcode='22023'; end if;
  if p_planned_weeks is not null and (p_planned_weeks<1 or p_planned_weeks>104) then raise exception 'Block duration is invalid' using errcode='22023'; end if;
  v_definition:=jsonb_set(coalesce(p_definition,'{"week":[]}'::jsonb),'{id}',to_jsonb(v_id::text),true); v_definition:=jsonb_set(v_definition,'{name}',to_jsonb(p_title),true); perform public.coach_validate_block_definition(v_definition);
  if v_context.programme_id is not null then select * into v_programme from public.coach_programmes where id=v_context.programme_id for update; end if;
  if v_programme.id is null then insert into public.coach_programmes(client_user_id,owner_coach_user_id,organisation_id,relationship_id,assignment_id,title) values(p_client_user_id,v_context.programme_owner_user_id,p_organisation_id,v_context.primary_relationship_id,v_context.primary_assignment_id,p_title) returning * into v_programme; end if;
  insert into public.coach_programme_blocks(id,programme_id,title,description,coach_notes,ordinal,planned_weeks,definition) values(v_id,v_programme.id,p_title,p_description,p_coach_notes,(select coalesce(max(ordinal),0)+1 from public.coach_programme_blocks where programme_id=v_programme.id),p_planned_weeks,v_definition) returning * into v_block;
  insert into public.coach_programme_block_revisions(block_id,revision_number,definition,change_note,created_by) values(v_block.id,1,v_block.definition,'Block created',auth.uid());
  return jsonb_build_object('id',v_block.id,'title',v_block.title,'status',v_block.status,'plannedWeeks',v_block.planned_weeks,'definition',v_block.definition);
end; $$;

create or replace function public.coach_save_programme_block(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid,p_relationship_id uuid,p_block_id uuid,p_definition jsonb,p_title text,p_description text default null,p_coach_notes text default null,p_planned_weeks integer default null,p_change_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context record; v_block public.coach_programme_blocks%rowtype; v_revision integer; v_generated jsonb; begin
  select * into v_context from public.coach_resolve_programme_context(p_client_user_id,p_organisation_id,p_assignment_id,p_relationship_id,true);
  if not found or v_context.programme_id is null then raise exception 'Only the Primary PT can manage programme blocks' using errcode='42501'; end if;
  p_definition:=jsonb_set(p_definition,'{id}',to_jsonb(p_block_id::text),true);
  perform public.coach_validate_block_definition(p_definition);
  select b.* into v_block from public.coach_programme_blocks b where b.id=p_block_id and b.programme_id=v_context.programme_id for update;
  if not found then raise exception 'Programme block is unavailable' using errcode='42501'; end if;
  update public.coach_programme_blocks set definition=p_definition,title=coalesce(nullif(btrim(p_title),''),title),description=p_description,coach_notes=p_coach_notes,planned_weeks=p_planned_weeks,updated_at=now() where id=v_block.id returning * into v_block;
  select coalesce(max(revision_number),0)+1 into v_revision from public.coach_programme_block_revisions where block_id=v_block.id;
  insert into public.coach_programme_block_revisions(block_id,revision_number,definition,change_note,created_by) values(v_block.id,v_revision,p_definition,p_change_note,auth.uid());
  if v_block.status='active' then update public.profiles set generated_programme=p_definition,active_programme_id=p_definition->>'id',updated_at=now() where id=p_client_user_id returning generated_programme into v_generated; if not found then raise exception 'Client profile is unavailable' using errcode='22023'; end if; end if;
  return jsonb_build_object('id',v_block.id,'status',v_block.status,'definition',v_block.definition,'revision',v_revision,'generated_programme',case when v_block.status='active' then v_generated else null end);
end; $$;

create or replace function public.coach_activate_programme_block(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid,p_relationship_id uuid,p_block_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context record; v_programme public.coach_programmes%rowtype; v_block public.coach_programme_blocks%rowtype; v_generated jsonb; v_revision integer; begin
  select * into v_context from public.coach_resolve_programme_context(p_client_user_id,p_organisation_id,p_assignment_id,p_relationship_id,true);
  if not found or v_context.programme_id is null then raise exception 'Only the Primary PT can activate programme blocks' using errcode='42501'; end if;
  select * into v_programme from public.coach_programmes where id=v_context.programme_id for update;
  if not found then raise exception 'Programme is unavailable' using errcode='42501'; end if;
  select b.* into v_block from public.coach_programme_blocks b where b.id=p_block_id and b.programme_id=v_programme.id for update;
  if not found then raise exception 'Programme block is unavailable' using errcode='42501'; end if;
  if v_block.status<>'draft' then raise exception 'Only a draft block can be activated; duplicate a previous block to reuse it' using errcode='22023'; end if;
  update public.coach_programme_blocks set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where programme_id=v_block.programme_id and status='active' and id<>v_block.id;
  update public.coach_programme_blocks set status='active',start_date=coalesce(start_date,current_date),activated_at=coalesce(activated_at,now()),updated_at=now() where id=v_block.id returning * into v_block;
  update public.profiles set generated_programme=v_block.definition,active_programme_id=v_block.definition->>'id',updated_at=now() where id=p_client_user_id returning generated_programme into v_generated;
  if not found then raise exception 'Client profile is unavailable' using errcode='22023'; end if;
  select coalesce(max(revision_number),0)+1 into v_revision from public.coach_programme_block_revisions where block_id=v_block.id;
  insert into public.coach_programme_block_revisions(block_id,revision_number,definition,change_note,created_by) values(v_block.id,v_revision,v_block.definition,'Block activated',auth.uid());
  return jsonb_build_object('id',v_block.id,'status',v_block.status,'definition',v_block.definition,'generated_programme',v_generated);
end; $$;

create or replace function public.coach_list_programme_revisions(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid,p_relationship_id uuid,p_block_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context record; v_block_id uuid; v_revisions jsonb; begin
  select * into v_context from public.coach_resolve_programme_context(p_client_user_id,p_organisation_id,p_assignment_id,p_relationship_id,false);
  if not found or v_context.programme_id is null then raise exception 'Coach programme access denied' using errcode='42501'; end if;
  select id into v_block_id from public.coach_programme_blocks where id=p_block_id and programme_id=v_context.programme_id;
  if not found then raise exception 'Programme block access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision_number,'definition',r.definition,'changeNote',r.change_note,'createdBy',r.created_by,'createdAt',r.created_at) order by r.revision_number desc),'[]'::jsonb) into v_revisions from public.coach_programme_block_revisions r where r.block_id=v_block_id;
  return v_revisions;
end; $$;

revoke all on function public.coach_resolve_programme_context(uuid,uuid,uuid,uuid,boolean), public.coach_validate_block_definition(jsonb), public.coach_list_programme_blocks(uuid,uuid,uuid,uuid), public.coach_create_programme_block(uuid,uuid,uuid,uuid,text,integer,jsonb,text,text), public.coach_save_programme_block(uuid,uuid,uuid,uuid,uuid,jsonb,text,text,text,integer,text), public.coach_activate_programme_block(uuid,uuid,uuid,uuid,uuid), public.coach_list_programme_revisions(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.coach_programme_revision_immutable() from public,anon,authenticated;
grant execute on function public.coach_list_programme_blocks(uuid,uuid,uuid,uuid), public.coach_create_programme_block(uuid,uuid,uuid,uuid,text,integer,jsonb,text,text), public.coach_save_programme_block(uuid,uuid,uuid,uuid,uuid,jsonb,text,text,text,integer,text), public.coach_activate_programme_block(uuid,uuid,uuid,uuid,uuid), public.coach_list_programme_revisions(uuid,uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.coach_set_programme_block_status(p_client_user_id uuid,p_organisation_id uuid,p_assignment_id uuid,p_relationship_id uuid,p_block_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context record; v_block public.coach_programme_blocks%rowtype; v_revision integer; begin
  select * into v_context from public.coach_resolve_programme_context(p_client_user_id,p_organisation_id,p_assignment_id,p_relationship_id,true);
  if p_status not in ('completed','archived') or not found or v_context.programme_id is null then raise exception 'Programme block status change denied' using errcode='42501'; end if;
  select * into v_block from public.coach_programme_blocks where id=p_block_id and programme_id=v_context.programme_id for update;
  if not found then raise exception 'Programme block is unavailable' using errcode='42501'; end if;
  if v_block.status='active' then raise exception 'Activate a successor before completing or archiving the active block' using errcode='22023'; end if;
  select coalesce(max(revision_number),0)+1 into v_revision from public.coach_programme_block_revisions where block_id=v_block.id;
  update public.coach_programme_blocks set status=p_status,completed_at=case when p_status='completed' then coalesce(completed_at,now()) else completed_at end,updated_at=now() where id=v_block.id returning * into v_block;
  insert into public.coach_programme_block_revisions(block_id,revision_number,definition,change_note,created_by) values(v_block.id,v_revision,v_block.definition,'Block marked '||p_status,auth.uid());
  return jsonb_build_object('id',v_block.id,'status',v_block.status);
end; $$;
revoke all on function public.coach_set_programme_block_status(uuid,uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.coach_set_programme_block_status(uuid,uuid,uuid,uuid,uuid,text) to authenticated;
