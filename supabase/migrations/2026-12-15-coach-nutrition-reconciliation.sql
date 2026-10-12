-- Reconcile the Coach Nutrition schema and RPC contract after the malformed
-- 2026-11-27 function definition. Safe whether that migration ran fully,
-- stopped after table setup, or was repaired/applied outside this repository.
-- No existing Nutrition records are deleted or rewritten by this migration.

create table if not exists public.nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users(id) on delete cascade,
  owner_coach_user_id uuid not null references auth.users(id) on delete restrict,
  relationship_id uuid references public.coach_relationships(id) on delete set null,
  organisation_id uuid references public.club_organisations(id) on delete set null,
  title text not null default 'Nutrition plan',
  status text not null default 'draft' check (status in ('draft','active','superseded','archived')),
  start_date date not null default current_date,
  review_date date,
  client_notes text not null default '',
  coach_private_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz
);
alter table public.nutrition_plans
  add column if not exists client_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists owner_coach_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists relationship_id uuid references public.coach_relationships(id) on delete set null,
  add column if not exists organisation_id uuid references public.club_organisations(id) on delete set null,
  add column if not exists title text not null default 'Nutrition plan',
  add column if not exists status text not null default 'draft',
  add column if not exists start_date date not null default current_date,
  add column if not exists review_date date,
  add column if not exists client_notes text not null default '',
  add column if not exists coach_private_notes text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists activated_at timestamptz,
  add column if not exists superseded_at timestamptz;

create table if not exists public.nutrition_targets (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null unique references public.nutrition_plans(id) on delete cascade,
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fibre_g numeric, water_ml numeric,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (calories is null or calories >= 0), check (protein_g is null or protein_g >= 0), check (carbs_g is null or carbs_g >= 0),
  check (fat_g is null or fat_g >= 0), check (fibre_g is null or fibre_g >= 0), check (water_ml is null or water_ml >= 0)
);
create table if not exists public.nutrition_meals (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  title text not null, sort_order integer not null default 0, instructions text not null default '', timing_text text not null default '', notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.nutrition_meal_items (
  id uuid primary key default gen_random_uuid(), meal_id uuid not null references public.nutrition_meals(id) on delete cascade,
  description text not null, portion_text text not null default '', sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.nutrition_meal_alternatives (
  id uuid primary key default gen_random_uuid(), meal_id uuid not null references public.nutrition_meals(id) on delete cascade,
  description text not null, sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.nutrition_supplements (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  name text not null, amount_text text not null default '', timing_text text not null default '', instructions text not null default '', sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.nutrition_daily_checkins (
  id uuid primary key default gen_random_uuid(), client_user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.nutrition_plans(id) on delete set null, checkin_date date not null,
  adherence text not null check (adherence in ('followed','mostly','no')),
  client_note text not null default '', submitted_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(client_user_id,checkin_date)
);
create table if not exists public.nutrition_extras (
  id uuid primary key default gen_random_uuid(), checkin_id uuid not null references public.nutrition_daily_checkins(id) on delete cascade,
  description text not null, amount_text text not null default '', note text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.nutrition_coach_feedback (
  id uuid primary key default gen_random_uuid(), coach_user_id uuid not null references auth.users(id) on delete cascade,
  client_user_id uuid not null references auth.users(id) on delete cascade, checkin_id uuid references public.nutrition_daily_checkins(id) on delete cascade,
  plan_id uuid references public.nutrition_plans(id) on delete cascade, message text not null,
  client_visible boolean not null default true, private_note boolean not null default false, created_at timestamptz not null default now()
);

-- These ALTERs repair an interrupted prefix where the base plan table existed
-- but was not fully shaped. CREATE TABLE above handles the absent-table case.
alter table public.nutrition_targets
  add column if not exists plan_id uuid references public.nutrition_plans(id) on delete cascade,
  add column if not exists calories numeric, add column if not exists protein_g numeric,
  add column if not exists carbs_g numeric, add column if not exists fat_g numeric,
  add column if not exists fibre_g numeric, add column if not exists water_ml numeric,
  add column if not exists created_at timestamptz not null default now(), add column if not exists updated_at timestamptz not null default now();
alter table public.nutrition_meals
  add column if not exists plan_id uuid references public.nutrition_plans(id) on delete cascade,
  add column if not exists title text not null default 'Meal', add column if not exists sort_order integer not null default 0,
  add column if not exists instructions text not null default '', add column if not exists timing_text text not null default '',
  add column if not exists notes text not null default '', add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
alter table public.nutrition_meal_items
  add column if not exists meal_id uuid references public.nutrition_meals(id) on delete cascade,
  add column if not exists description text not null default '', add column if not exists portion_text text not null default '',
  add column if not exists sort_order integer not null default 0, add column if not exists created_at timestamptz not null default now();
alter table public.nutrition_meal_alternatives
  add column if not exists meal_id uuid references public.nutrition_meals(id) on delete cascade,
  add column if not exists description text not null default '', add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now();
alter table public.nutrition_supplements
  add column if not exists plan_id uuid references public.nutrition_plans(id) on delete cascade,
  add column if not exists name text not null default '', add column if not exists amount_text text not null default '',
  add column if not exists timing_text text not null default '', add column if not exists instructions text not null default '',
  add column if not exists sort_order integer not null default 0, add column if not exists created_at timestamptz not null default now();
alter table public.nutrition_daily_checkins
  add column if not exists client_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists plan_id uuid references public.nutrition_plans(id) on delete set null,
  add column if not exists checkin_date date, add column if not exists adherence text,
  add column if not exists client_note text not null default '', add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
alter table public.nutrition_extras
  add column if not exists checkin_id uuid references public.nutrition_daily_checkins(id) on delete cascade,
  add column if not exists description text not null default '', add column if not exists amount_text text not null default '',
  add column if not exists note text not null default '', add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
alter table public.nutrition_coach_feedback
  add column if not exists coach_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists client_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists checkin_id uuid references public.nutrition_daily_checkins(id) on delete cascade,
  add column if not exists plan_id uuid references public.nutrition_plans(id) on delete cascade,
  add column if not exists message text not null default '', add column if not exists client_visible boolean not null default true,
  add column if not exists private_note boolean not null default false, add column if not exists created_at timestamptz not null default now();

create unique index if not exists nutrition_one_active_plan_per_client on public.nutrition_plans(client_user_id) where status='active';
create unique index if not exists nutrition_one_current_draft_per_owner on public.nutrition_plans(client_user_id,owner_coach_user_id) where status='draft';
create index if not exists nutrition_plans_client_idx on public.nutrition_plans(client_user_id,status,updated_at desc);
create index if not exists nutrition_plans_owner_idx on public.nutrition_plans(owner_coach_user_id,status,updated_at desc);
create index if not exists nutrition_meals_plan_idx on public.nutrition_meals(plan_id,sort_order,id);
create index if not exists nutrition_meal_items_meal_idx on public.nutrition_meal_items(meal_id,sort_order,id);
create index if not exists nutrition_checkins_client_idx on public.nutrition_daily_checkins(client_user_id,checkin_date desc);
create index if not exists nutrition_feedback_client_idx on public.nutrition_coach_feedback(client_user_id,created_at desc);
do $$
declare v_target_plan smallint; v_checkin_client smallint; v_checkin_date smallint;
begin
  select attnum into v_target_plan from pg_catalog.pg_attribute where attrelid='public.nutrition_targets'::regclass and attname='plan_id' and not attisdropped;
  if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='public.nutrition_targets'::regclass and c.contype in ('p','u') and c.conkey=array[v_target_plan]::smallint[]) then
    if exists(select 1 from public.nutrition_targets group by plan_id having count(*)>1) then raise exception 'Duplicate nutrition targets per plan must be reviewed before adding uniqueness'; end if;
    alter table public.nutrition_targets add constraint nutrition_targets_plan_id_unique unique(plan_id);
  end if;
  select attnum into v_checkin_client from pg_catalog.pg_attribute where attrelid='public.nutrition_daily_checkins'::regclass and attname='client_user_id' and not attisdropped;
  select attnum into v_checkin_date from pg_catalog.pg_attribute where attrelid='public.nutrition_daily_checkins'::regclass and attname='checkin_date' and not attisdropped;
  if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='public.nutrition_daily_checkins'::regclass and c.contype in ('p','u') and c.conkey=array[v_checkin_client,v_checkin_date]::smallint[]) then
    if exists(select 1 from public.nutrition_daily_checkins group by client_user_id,checkin_date having count(*)>1) then raise exception 'Duplicate daily check-ins must be reviewed before adding uniqueness'; end if;
    alter table public.nutrition_daily_checkins add constraint nutrition_daily_checkins_client_date_unique unique(client_user_id,checkin_date);
  end if;
end $$;

alter table public.nutrition_plans enable row level security;
alter table public.nutrition_targets enable row level security;
alter table public.nutrition_meals enable row level security;
alter table public.nutrition_meal_items enable row level security;
alter table public.nutrition_meal_alternatives enable row level security;
alter table public.nutrition_supplements enable row level security;
alter table public.nutrition_daily_checkins enable row level security;
alter table public.nutrition_extras enable row level security;
alter table public.nutrition_coach_feedback enable row level security;
-- These tables are deliberately RPC-only (no direct-access policies); retain
-- any unexpected existing policies but leave direct table grants revoked.
revoke all on table public.nutrition_plans,public.nutrition_targets,public.nutrition_meals,public.nutrition_meal_items,public.nutrition_meal_alternatives,public.nutrition_supplements,public.nutrition_daily_checkins,public.nutrition_extras,public.nutrition_coach_feedback from public,anon,authenticated;

create or replace function public.nutrition_can_read_client(p_client_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and p_client_user_id is not null and (
    auth.uid()=p_client_user_id
    or exists (
      select 1 from public.coach_relationships r
      where r.client_user_id=p_client_user_id and r.coach_user_id=auth.uid() and r.status='active'
        and public.coach_has_explicit_access(auth.uid())
        and (r.organisation_id is null or exists (
          select 1 from public.coach_permissions cp join public.club_members coach_member
            on coach_member.organisation_id=cp.organisation_id and coach_member.user_id=auth.uid()
          join public.club_members client_member on client_member.organisation_id=cp.organisation_id and client_member.user_id=p_client_user_id
          where cp.organisation_id=r.organisation_id and cp.user_id=auth.uid() and cp.active
            and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner') and client_member.active
        ))
    )
    or exists (
      select 1 from public.coach_client_assignments a
      join public.coach_permissions cp on cp.organisation_id=a.organisation_id and cp.user_id=auth.uid() and cp.active
      join public.club_members coach_member on coach_member.organisation_id=a.organisation_id and coach_member.user_id=auth.uid() and coach_member.active and coach_member.role in ('trainer','gym_staff','gym_admin','owner')
      join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=p_client_user_id and client_member.active
      where a.client_user_id=p_client_user_id and a.coach_user_id=auth.uid() and a.active
    )
  );
$$;

create or replace function public.nutrition_can_manage_plan(p_client_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and p_client_user_id is not null and (
    exists (select 1 from public.coach_relationships r where r.client_user_id=p_client_user_id and r.coach_user_id=auth.uid() and r.relationship_type='primary' and r.status='active' and public.coach_has_explicit_access(auth.uid()) and (r.organisation_id is null or exists(select 1 from public.coach_permissions cp join public.club_members cm on cm.organisation_id=cp.organisation_id and cm.user_id=auth.uid() and cm.active and cm.role in ('trainer','gym_staff','gym_admin','owner') join public.club_members client_member on client_member.organisation_id=cp.organisation_id and client_member.user_id=p_client_user_id and client_member.active where cp.organisation_id=r.organisation_id and cp.user_id=auth.uid() and cp.active)))
    or exists (select 1 from public.coach_client_assignments a join public.coach_permissions cp on cp.organisation_id=a.organisation_id and cp.user_id=auth.uid() and cp.active join public.club_members cm on cm.organisation_id=a.organisation_id and cm.user_id=auth.uid() and cm.active and cm.role in ('trainer','gym_staff','gym_admin','owner') join public.club_members client_member on client_member.organisation_id=a.organisation_id and client_member.user_id=p_client_user_id and client_member.active where a.client_user_id=p_client_user_id and a.coach_user_id=auth.uid() and a.relationship_type='primary' and a.active)
  );
$$;

create or replace function public.nutrition_plan_json(p_plan_id uuid,p_include_private boolean default false)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('id',p.id,'clientUserId',p.client_user_id,'ownerCoachUserId',p.owner_coach_user_id,'relationshipId',p.relationship_id,'organisationId',p.organisation_id,'title',p.title,'status',p.status,'startDate',p.start_date,'reviewDate',p.review_date,'clientNotes',p.client_notes,'coachPrivateNotes',case when p_include_private then p.coach_private_notes else null end,'targets',coalesce((select to_jsonb(t) - 'id' - 'plan_id' from public.nutrition_targets t where t.plan_id=p.id),'{}'::jsonb),'meals',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'sortOrder',m.sort_order,'instructions',m.instructions,'timingText',m.timing_text,'notes',m.notes,'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'description',i.description,'portionText',i.portion_text,'sortOrder',i.sort_order) order by i.sort_order,i.id) from public.nutrition_meal_items i where i.meal_id=m.id),'[]'::jsonb),'alternatives',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'description',a.description,'sortOrder',a.sort_order) order by a.sort_order,a.id) from public.nutrition_meal_alternatives a where a.meal_id=m.id),'[]'::jsonb)) order by m.sort_order,m.id) from public.nutrition_meals m where m.plan_id=p.id),'[]'::jsonb),'supplements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'amountText',s.amount_text,'timingText',s.timing_text,'instructions',s.instructions,'sortOrder',s.sort_order) order by s.sort_order,s.id) from public.nutrition_supplements s where s.plan_id=p.id),'[]'::jsonb),'createdAt',p.created_at,'updatedAt',p.updated_at)
from public.nutrition_plans p where p.id=p_plan_id;
$$;

create or replace function public.nutrition_safe_timezone(p_user_id uuid,p_requested_timezone text default null)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce((select p.timezone from public.profiles p where p.id=p_user_id and p.timezone is not null and exists(select 1 from pg_catalog.pg_timezone_names z where z.name=p.timezone)),case when p_requested_timezone is not null and exists(select 1 from pg_catalog.pg_timezone_names z where z.name=p_requested_timezone) then p_requested_timezone end,'Europe/London');
$$;

create or replace function public.nutrition_get_member_view(p_requested_timezone text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_plan uuid; v_today date; v_timezone text; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_timezone:=public.nutrition_safe_timezone(auth.uid(),p_requested_timezone); v_today:=(now() at time zone v_timezone)::date;
  select p.id into v_plan from public.nutrition_plans p where p.client_user_id=auth.uid() and p.status='active' order by p.activated_at desc limit 1;
  select jsonb_build_object('plan',case when v_plan is null then null else public.nutrition_plan_json(v_plan,false) end,'timezone',v_timezone,'checkins',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'date',c.checkin_date,'adherence',c.adherence,'clientNote',c.client_note,'submittedAt',c.submitted_at,'extras',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'description',e.description,'amountText',e.amount_text,'note',e.note) order by e.created_at) from public.nutrition_extras e where e.checkin_id=c.id),'[]'::jsonb)) order by c.checkin_date desc) from public.nutrition_daily_checkins c where c.client_user_id=auth.uid() and c.checkin_date>=v_today-30),'[]'::jsonb),'checkinDays',coalesce((select jsonb_agg(jsonb_build_object('date',days.day::date,'adherence',c.adherence,'checkinId',c.id,'clientNote',c.client_note,'extrasCount',coalesce((select count(*) from public.nutrition_extras e where e.checkin_id=c.id),0)) order by days.day desc) from generate_series(v_today-6,v_today,interval '1 day') days(day) left join public.nutrition_daily_checkins c on c.client_user_id=auth.uid() and c.checkin_date=days.day::date),'[]'::jsonb),'feedback',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'message',f.message,'createdAt',f.created_at,'checkinId',f.checkin_id) order by f.created_at desc) from public.nutrition_coach_feedback f where f.client_user_id=auth.uid() and f.client_visible and not f.private_note),'[]'::jsonb)) into result;
  return result;
end; $$;

create or replace function public.nutrition_get_coach_view(p_client_user_id uuid,p_requested_timezone text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_active_plan uuid; v_draft_plan uuid; v_private boolean; v_today date; v_timezone text; result jsonb;
begin
  if not public.nutrition_can_read_client(p_client_user_id) then raise exception 'Nutrition access denied' using errcode='42501'; end if;
  v_private:=public.nutrition_can_manage_plan(p_client_user_id); v_timezone:=public.nutrition_safe_timezone(p_client_user_id,p_requested_timezone); v_today:=(now() at time zone v_timezone)::date;
  select p.id into v_active_plan from public.nutrition_plans p where p.client_user_id=p_client_user_id and p.status='active' order by p.activated_at desc limit 1;
  if v_private then select p.id into v_draft_plan from public.nutrition_plans p where p.client_user_id=p_client_user_id and p.owner_coach_user_id=auth.uid() and p.status='draft' order by p.updated_at desc limit 1; end if;
  select jsonb_build_object('activePlan',case when v_active_plan is null then null else public.nutrition_plan_json(v_active_plan,v_private) end,'draftPlan',case when v_draft_plan is null then null else public.nutrition_plan_json(v_draft_plan,true) end,'plan',case when v_active_plan is null then null else public.nutrition_plan_json(v_active_plan,v_private) end,'canManage',v_private,'timezone',v_timezone,'checkins',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'date',c.checkin_date,'adherence',c.adherence,'clientNote',c.client_note,'submittedAt',c.submitted_at,'extrasCount',(select count(*) from public.nutrition_extras e where e.checkin_id=c.id)) order by c.checkin_date desc) from public.nutrition_daily_checkins c where c.client_user_id=p_client_user_id and c.checkin_date>=v_today-6),'[]'::jsonb),'checkinDays',coalesce((select jsonb_agg(jsonb_build_object('date',days.day::date,'adherence',c.adherence,'checkinId',c.id,'clientNote',c.client_note,'extrasCount',coalesce((select count(*) from public.nutrition_extras e where e.checkin_id=c.id),0)) order by days.day desc) from generate_series(v_today-6,v_today,interval '1 day') days(day) left join public.nutrition_daily_checkins c on c.client_user_id=p_client_user_id and c.checkin_date=days.day::date),'[]'::jsonb),'feedback',case when v_private then coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'message',f.message,'clientVisible',f.client_visible,'privateNote',f.private_note,'createdAt',f.created_at) order by f.created_at desc) from public.nutrition_coach_feedback f where f.client_user_id=p_client_user_id),'[]'::jsonb) else coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'message',f.message,'clientVisible',true,'createdAt',f.created_at) order by f.created_at desc) from public.nutrition_coach_feedback f where f.client_user_id=p_client_user_id and f.client_visible and not f.private_note),'[]'::jsonb) end) into result;
  return result;
end; $$;

create or replace function public.nutrition_save_draft(p_client_user_id uuid,p_payload jsonb,p_plan_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nutrition_plans%rowtype; t jsonb; m jsonb; i jsonb; a jsonb; s jsonb; v_meal uuid; v_relationship uuid; v_organisation uuid;
begin
  if not public.nutrition_can_manage_plan(p_client_user_id) then raise exception 'Only the Primary PT can edit this nutrition plan' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) is distinct from 'object' then raise exception 'Invalid nutrition plan' using errcode='22023'; end if;
  if p_plan_id is null then select id into p_plan_id from public.nutrition_plans where client_user_id=p_client_user_id and owner_coach_user_id=auth.uid() and status='draft' order by updated_at desc limit 1; end if;
  if p_plan_id is not null then select * into p from public.nutrition_plans where id=p_plan_id and client_user_id=p_client_user_id and owner_coach_user_id=auth.uid() for update; if not found or p.status<>'draft' then raise exception 'Only a draft plan can be edited' using errcode='42501'; end if;
  else
    select r.id,r.organisation_id into v_relationship,v_organisation from public.coach_relationships r where r.client_user_id=p_client_user_id and r.coach_user_id=auth.uid() and r.relationship_type='primary' and r.status='active' order by r.created_at desc limit 1;
    if not found then select null::uuid,a.organisation_id into v_relationship,v_organisation from public.coach_client_assignments a where a.client_user_id=p_client_user_id and a.coach_user_id=auth.uid() and a.relationship_type='primary' and a.active order by a.created_at desc limit 1; end if;
    insert into public.nutrition_plans(client_user_id,owner_coach_user_id,relationship_id,organisation_id,title,start_date,review_date,client_notes,coach_private_notes)
    values(p_client_user_id,auth.uid(),v_relationship,v_organisation,coalesce(nullif(left(p_payload->>'title',160),''),'Nutrition plan'),coalesce(nullif(p_payload->>'startDate','')::date,current_date),nullif(p_payload->>'reviewDate','')::date,left(coalesce(p_payload->>'clientNotes',''),4000),left(coalesce(p_payload->>'coachPrivateNotes',''),4000)) returning * into p;
  end if;
  if p_plan_id is not null then update public.nutrition_plans set title=coalesce(nullif(left(p_payload->>'title',160),''),'Nutrition plan'),start_date=coalesce(nullif(p_payload->>'startDate','')::date,start_date),review_date=nullif(p_payload->>'reviewDate','')::date,client_notes=left(coalesce(p_payload->>'clientNotes',''),4000),coach_private_notes=left(coalesce(p_payload->>'coachPrivateNotes',''),4000),updated_at=now() where id=p.id returning * into p; end if;
  delete from public.nutrition_targets where plan_id=p.id; delete from public.nutrition_meals where plan_id=p.id; delete from public.nutrition_supplements where plan_id=p.id;
  t:=coalesce(p_payload->'targets','{}'::jsonb); insert into public.nutrition_targets(plan_id,calories,protein_g,carbs_g,fat_g,fibre_g,water_ml) values(p.id,nullif(t->>'calories','')::numeric,nullif(t->>'protein','')::numeric,nullif(t->>'carbs','')::numeric,nullif(t->>'fat','')::numeric,nullif(t->>'fibre','')::numeric,nullif(t->>'water','')::numeric);
  for m in select value from jsonb_array_elements(coalesce(p_payload->'meals','[]'::jsonb)) loop
    insert into public.nutrition_meals(plan_id,title,sort_order,instructions,timing_text,notes) values(p.id,coalesce(nullif(left(m->>'title',160),''),'Meal'),coalesce((m->>'sortOrder')::integer,0),left(coalesce(m->>'instructions',''),4000),left(coalesce(m->>'timingText',''),160),left(coalesce(m->>'notes',''),4000)) returning id into v_meal;
    for i in select value from jsonb_array_elements(coalesce(m->'items','[]'::jsonb)) loop insert into public.nutrition_meal_items(meal_id,description,portion_text,sort_order) values(v_meal,left(coalesce(i->>'description',''),500),left(coalesce(i->>'portionText',''),160),coalesce((i->>'sortOrder')::integer,0)); end loop;
    for a in select value from jsonb_array_elements(coalesce(m->'alternatives','[]'::jsonb)) loop insert into public.nutrition_meal_alternatives(meal_id,description,sort_order) values(v_meal,left(coalesce(a->>'description',''),500),coalesce((a->>'sortOrder')::integer,0)); end loop;
  end loop;
  for s in select value from jsonb_array_elements(coalesce(p_payload->'supplements','[]'::jsonb)) loop insert into public.nutrition_supplements(plan_id,name,amount_text,timing_text,instructions,sort_order) values(p.id,left(coalesce(s->>'name',''),160),left(coalesce(s->>'amountText',''),160),left(coalesce(s->>'timingText',''),160),left(coalesce(s->>'instructions',''),1000),coalesce((s->>'sortOrder')::integer,0)); end loop;
  return public.nutrition_plan_json(p.id,true);
end; $$;

create or replace function public.nutrition_activate_plan(p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nutrition_plans%rowtype;
begin
  select * into p from public.nutrition_plans where id=p_plan_id for update;
  if not found or p.status<>'draft' or p.owner_coach_user_id<>auth.uid() or not public.nutrition_can_manage_plan(p.client_user_id) then raise exception 'Only the Primary PT can activate this draft' using errcode='42501'; end if;
  update public.nutrition_plans set status='superseded',superseded_at=now(),updated_at=now() where client_user_id=p.client_user_id and status='active';
  update public.nutrition_plans set status='active',activated_at=now(),updated_at=now() where id=p.id;
  return public.nutrition_plan_json(p.id,true);
end; $$;

create or replace function public.nutrition_save_daily_checkin(p_adherence text,p_client_note text default '',p_timezone text default 'Europe/London')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date; p uuid; c public.nutrition_daily_checkins%rowtype;
begin
  if auth.uid() is null or p_adherence not in ('followed','mostly','no') then raise exception 'Choose a valid daily check-in' using errcode='22023'; end if;
  d:=(now() at time zone public.nutrition_safe_timezone(auth.uid(),p_timezone))::date;
  select id into p from public.nutrition_plans where client_user_id=auth.uid() and status='active' order by activated_at desc limit 1;
  if p is null then raise exception 'No active nutrition plan is available' using errcode='22023'; end if;
  insert into public.nutrition_daily_checkins(client_user_id,plan_id,checkin_date,adherence,client_note) values(auth.uid(),p,d,p_adherence,left(coalesce(p_client_note,''),2000))
  on conflict(client_user_id,checkin_date) do update set adherence=excluded.adherence,client_note=excluded.client_note,updated_at=now()
  returning * into c;
  return jsonb_build_object('id',c.id,'date',c.checkin_date,'adherence',c.adherence,'clientNote',c.client_note);
end; $$;

create or replace function public.nutrition_add_extra(p_description text,p_amount_text text default '',p_note text default '',p_timezone text default 'Europe/London')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid; e public.nutrition_extras%rowtype;
begin
  select id into c from public.nutrition_daily_checkins where client_user_id=auth.uid() and checkin_date=(now() at time zone public.nutrition_safe_timezone(auth.uid(),p_timezone))::date;
  if c is null or nullif(btrim(p_description),'') is null then raise exception 'Save today’s check-in before adding an extra' using errcode='22023'; end if;
  insert into public.nutrition_extras(checkin_id,description,amount_text,note) values(c,left(btrim(p_description),500),left(coalesce(p_amount_text,''),160),left(coalesce(p_note,''),1000)) returning * into e;
  return jsonb_build_object('id',e.id,'description',e.description,'amountText',e.amount_text,'note',e.note);
end; $$;

create or replace function public.nutrition_delete_extra(p_extra_id uuid,p_timezone text default 'Europe/London')
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.nutrition_extras e using public.nutrition_daily_checkins c where e.id=p_extra_id and e.checkin_id=c.id and c.client_user_id=auth.uid() and c.checkin_date=(now() at time zone public.nutrition_safe_timezone(auth.uid(),p_timezone))::date;
end; $$;

create or replace function public.nutrition_update_extra(p_extra_id uuid,p_description text,p_amount_text text default '',p_note text default '',p_timezone text default 'Europe/London')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.nutrition_extras%rowtype;
begin
  update public.nutrition_extras ex set description=left(btrim(p_description),500),amount_text=left(coalesce(p_amount_text,''),160),note=left(coalesce(p_note,''),1000),updated_at=now()
  from public.nutrition_daily_checkins c where ex.id=p_extra_id and ex.checkin_id=c.id and c.client_user_id=auth.uid() and c.checkin_date=(now() at time zone public.nutrition_safe_timezone(auth.uid(),p_timezone))::date and nullif(btrim(p_description),'') is not null returning ex.* into e;
  if not found then raise exception 'That extra could not be updated' using errcode='42501'; end if;
  return jsonb_build_object('id',e.id,'description',e.description,'amountText',e.amount_text,'note',e.note);
end; $$;

create or replace function public.nutrition_leave_feedback(p_client_user_id uuid,p_checkin_id uuid,p_message text,p_client_visible boolean default true,p_private_note boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.nutrition_coach_feedback%rowtype;
begin
  if not public.nutrition_can_manage_plan(p_client_user_id) then raise exception 'Only the Primary PT can leave nutrition feedback' using errcode='42501'; end if;
  if nullif(btrim(p_message),'') is null or length(p_message)>4000 then raise exception 'Enter a valid feedback message' using errcode='22023'; end if;
  if p_checkin_id is not null and not exists(select 1 from public.nutrition_daily_checkins c where c.id=p_checkin_id and c.client_user_id=p_client_user_id) then raise exception 'That check-in does not belong to this client' using errcode='42501'; end if;
  insert into public.nutrition_coach_feedback(coach_user_id,client_user_id,checkin_id,message,client_visible,private_note)
  values(auth.uid(),p_client_user_id,p_checkin_id,btrim(p_message),p_client_visible and not p_private_note,p_private_note) returning * into f;
  return jsonb_build_object('id',f.id,'message',f.message,'clientVisible',f.client_visible,'privateNote',f.private_note,'createdAt',f.created_at);
end; $$;

revoke all on function public.nutrition_can_read_client(uuid),public.nutrition_can_manage_plan(uuid),public.nutrition_plan_json(uuid,boolean),public.nutrition_safe_timezone(uuid,text),public.nutrition_get_member_view(text),public.nutrition_get_coach_view(uuid,text),public.nutrition_save_draft(uuid,jsonb,uuid),public.nutrition_activate_plan(uuid),public.nutrition_save_daily_checkin(text,text,text),public.nutrition_add_extra(text,text,text,text),public.nutrition_update_extra(uuid,text,text,text,text),public.nutrition_delete_extra(uuid,text),public.nutrition_leave_feedback(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.nutrition_get_member_view(text),public.nutrition_save_daily_checkin(text,text,text),public.nutrition_add_extra(text,text,text,text),public.nutrition_update_extra(uuid,text,text,text,text),public.nutrition_delete_extra(uuid,text) to authenticated;
grant execute on function public.nutrition_get_coach_view(uuid,text),public.nutrition_save_draft(uuid,jsonb,uuid),public.nutrition_activate_plan(uuid),public.nutrition_leave_feedback(uuid,uuid,text,boolean,boolean) to authenticated;
