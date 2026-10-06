-- R12 MADHOUSE MANUAL SCHEMA RECONCILIATION
-- Copy this entire file into Supabase SQL Editor and run once.
-- This bundle assumes the documented manual baseline is already applied.
-- It creates schema only. It does not create Auth users, organisations, members, memberships, payments, or Coach grants.
-- Do not run the excluded operational/data migrations as part of this bundle.
-- Included additive foundations: 2026-11-22-r12-profile-foundation.sql and 2026-11-22-r12-deployment-ledger.sql.

-- Idempotent profile foundation used by both Member and Club/Coach.
-- This preserves existing rows and only adds fields required by current code.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text,
  first_name text,
  last_name text,
  timezone text not null default 'Europe/London',
  step_goal integer not null default 10000,
  goals jsonb not null default '[]'::jsonb,
  training_profile jsonb,
  generated_programme jsonb,
  active_programme_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists timezone text not null default 'Europe/London';
alter table public.profiles add column if not exists step_goal integer not null default 10000;
alter table public.profiles add column if not exists goals jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists training_profile jsonb;
alter table public.profiles add column if not exists generated_programme jsonb;
alter table public.profiles add column if not exists active_programme_id text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles set email=coalesce(email,'') where email is null;
alter table public.profiles alter column email set default '';
alter table public.profiles alter column email set not null;
alter table public.profiles enable row level security;
do $policy$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='r12_profiles_self') then
    create policy r12_profiles_self on public.profiles for all to authenticated using (id=auth.uid()) with check (id=auth.uid());
  end if;
end;
$policy$;
revoke all on public.profiles from anon;
grant select,insert,update on public.profiles to authenticated;

-- === R12 DEPLOYMENT LEDGER ===
-- Deployment metadata only. It does not infer that a migration ran merely
-- because its file exists; the runner records successful executions.
create table if not exists public.r12_schema_migrations (
  migration_name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now(),
  source text not null default 'r12-runner',
  note text
);
alter table public.r12_schema_migrations enable row level security;
revoke all on public.r12_schema_migrations from public,anon,authenticated;


-- === R12 WHOOP FOUNDATION ===
-- The historical 2026-08-30 patch assumes these tables already exist. The
-- current application contract is the same as the repository schema contract.
create table if not exists public.whoop_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz
);
alter table public.whoop_connections add column if not exists user_id uuid;
alter table public.whoop_connections add column if not exists access_token_encrypted text;
alter table public.whoop_connections add column if not exists refresh_token_encrypted text;
alter table public.whoop_connections add column if not exists expires_at timestamptz;
alter table public.whoop_connections add column if not exists scopes text[] not null default '{}';
alter table public.whoop_connections add column if not exists connected_at timestamptz not null default now();
alter table public.whoop_connections add column if not exists updated_at timestamptz not null default now();
alter table public.whoop_connections add column if not exists last_sync_at timestamptz;
create unique index if not exists whoop_connections_user_id_key on public.whoop_connections (user_id);
alter table public.whoop_connections enable row level security;
revoke all on public.whoop_connections from anon,authenticated;

create table if not exists public.whoop_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  record_type text not null,
  provider_timestamp timestamptz,
  payload jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, provider_id, record_type)
);
alter table public.whoop_records add column if not exists user_id uuid;
alter table public.whoop_records add column if not exists provider_id text;
alter table public.whoop_records add column if not exists record_type text;
alter table public.whoop_records add column if not exists provider_timestamp timestamptz;
alter table public.whoop_records add column if not exists payload jsonb;
alter table public.whoop_records add column if not exists synced_at timestamptz not null default now();
create unique index if not exists whoop_records_identity_key on public.whoop_records (user_id, provider_id, record_type);
alter table public.whoop_records enable row level security;
revoke all on public.whoop_records from anon,authenticated;


-- === APPLY supabase/migrations/2026-08-30-whoop-persistence.sql ===
alter table if exists public.whoop_connections add column if not exists updated_at timestamptz not null default now();
alter table if exists public.whoop_connections add column if not exists last_sync_at timestamptz;
create unique index if not exists whoop_connections_user_id_key on public.whoop_connections (user_id);
alter table if exists public.whoop_connections enable row level security;
alter table if exists public.whoop_records enable row level security;
-- No browser policies are granted for token/record tables; server service-role routes enforce the authenticated user_id.


-- === APPLY supabase/migrations/2026-08-31-profile-names.sql ===
alter table if exists public.profiles add column if not exists first_name text;
alter table if exists public.profiles add column if not exists last_name text;


-- === APPLY supabase/migrations/2026-08-31-workout-persistence.sql ===
-- Phase 1 workout persistence foundation. Run after the profile migrations.
create or replace function public.set_workout_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.workout_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_session_id text,
  scheduled_date date,
  status text not null default 'active' check (status in ('active', 'completed')),
  name text not null,
  workout_type text,
  started_at timestamptz not null,
  completed_at timestamptz,
  origin text not null default 'real' check (origin in ('real', 'historical', 'test')),
  source text not null default 'app',
  version integer not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_sessions_completed_time check (completed_at is null or completed_at >= started_at)
);

create unique index if not exists workout_sessions_user_plan_date
  on public.workout_sessions (user_id, planned_session_id, scheduled_date)
  where planned_session_id is not null and scheduled_date is not null;
create index if not exists workout_sessions_user_date on public.workout_sessions (user_id, scheduled_date desc);
create index if not exists workout_sessions_user_status on public.workout_sessions (user_id, status);

create table if not exists public.workout_sets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id text not null,
  exercise_name text not null,
  exercise_order integer,
  set_order integer not null,
  kind text not null check (kind in ('warmup', 'ramp', 'working')),
  weight numeric,
  reps integer,
  rir numeric,
  side text,
  feedback text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workout_sets_user_session_order on public.workout_sets (user_id, session_id, set_order);
create index if not exists workout_sets_exercise on public.workout_sets (user_id, exercise_id, created_at desc);

create table if not exists public.workout_cardio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null unique references public.workout_sessions(id) on delete cascade,
  modality text not null,
  duration numeric,
  completed boolean not null default false,
  perceived_effort numeric,
  pain text,
  prescribed_settings jsonb not null default '{}'::jsonb,
  actual_settings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workout_cardio_user_date on public.workout_cardio (user_id, created_at desc);

create table if not exists public.workout_import_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'local-first',
  source_record_id text not null,
  source_hash text not null,
  imported_session_id uuid references public.workout_sessions(id) on delete set null,
  status text not null default 'imported' check (status in ('imported', 'skipped', 'failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_record_id, source_hash)
);
create index if not exists workout_import_receipts_user on public.workout_import_receipts (user_id, created_at desc);

alter table public.workout_sessions enable row level security;
alter table public.workout_sets enable row level security;
alter table public.workout_cardio enable row level security;
alter table public.workout_import_receipts enable row level security;

drop policy if exists "own workout sessions" on public.workout_sessions;
create policy "own workout sessions" on public.workout_sessions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own workout sets" on public.workout_sets;
create policy "own workout sets" on public.workout_sets for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
drop policy if exists "own workout cardio" on public.workout_cardio;
create policy "own workout cardio" on public.workout_cardio for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
drop policy if exists "own workout imports" on public.workout_import_receipts;
create policy "own workout imports" on public.workout_import_receipts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on table public.workout_sessions to authenticated;
grant select, insert, update, delete on table public.workout_sets to authenticated;
grant select, insert, update, delete on table public.workout_cardio to authenticated;
grant select, insert, update, delete on table public.workout_import_receipts to authenticated;

drop trigger if exists workout_sessions_updated_at on public.workout_sessions;
create trigger workout_sessions_updated_at before update on public.workout_sessions for each row execute function public.set_workout_updated_at();
drop trigger if exists workout_sets_updated_at on public.workout_sets;
create trigger workout_sets_updated_at before update on public.workout_sets for each row execute function public.set_workout_updated_at();
drop trigger if exists workout_cardio_updated_at on public.workout_cardio;
create trigger workout_cardio_updated_at before update on public.workout_cardio for each row execute function public.set_workout_updated_at();
drop trigger if exists workout_import_receipts_updated_at on public.workout_import_receipts;
create trigger workout_import_receipts_updated_at before update on public.workout_import_receipts for each row execute function public.set_workout_updated_at();


-- === APPLY supabase/migrations/2026-09-01-training-programmes.sql ===
alter table if exists public.profiles add column if not exists training_profile jsonb;
alter table if exists public.profiles add column if not exists generated_programme jsonb;
alter table if exists public.profiles add column if not exists active_programme_id text;


-- === APPLY supabase/migrations/2026-09-02-training-scheduling-persistence.sql ===
-- Reviewed but intentionally NOT executed. Requires manual production approval.
create table if not exists public.training_availability_overrides (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null, end_date date not null, available_days smallint[], unavailable_dates date[] not null default '{}',
  sessions_per_week smallint, session_minutes smallint, environment text, equipment jsonb not null default '[]'::jsonb,
  reason text, source text not null default 'user' check (source in ('user','coach','scheduler')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date >= start_date), unique (user_id, start_date, end_date)
);
create table if not exists public.training_occurrence_outcomes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  programme_id text, session_template_id text not null, occurrence_id text not null, scheduled_date date not null,
  outcome text not null check (outcome in ('completed','partial','missed','rescheduled')), reason text,
  original_occurrence_id text, original_scheduled_date date, new_scheduled_date date,
  source text not null default 'user' check (source in ('user','coach','workout')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (user_id, occurrence_id)
);
create table if not exists public.training_occurrence_adjustments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  programme_id text, occurrence_id text not null, scheduled_date date not null, adjustment jsonb not null,
  source text not null default 'coach' check (source in ('user','coach','scheduler')), idempotency_key text not null,
  approved_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists training_availability_overrides_user_dates on public.training_availability_overrides (user_id, start_date, end_date);
create index if not exists training_occurrence_outcomes_user_dates on public.training_occurrence_outcomes (user_id, scheduled_date);
create index if not exists training_occurrence_adjustments_user_dates on public.training_occurrence_adjustments (user_id, scheduled_date);
alter table public.training_availability_overrides enable row level security;
alter table public.training_occurrence_outcomes enable row level security;
alter table public.training_occurrence_adjustments enable row level security;
drop policy if exists "own availability overrides" on public.training_availability_overrides;
create policy "own availability overrides" on public.training_availability_overrides for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own occurrence outcomes" on public.training_occurrence_outcomes;
create policy "own occurrence outcomes" on public.training_occurrence_outcomes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own occurrence adjustments" on public.training_occurrence_adjustments;
create policy "own occurrence adjustments" on public.training_occurrence_adjustments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.training_availability_overrides, public.training_occurrence_outcomes, public.training_occurrence_adjustments to authenticated;


-- === APPLY supabase/migrations/2026-09-10-club-membership-access.sql ===
-- R12 Club membership/access read foundation (forward-only; review before execution).
-- No member assignments or user-specific backfills are performed here. Home gym is
-- a preference; entitlement scope remains the authority for location access.

do $$ begin
  if not exists (select 1 from pg_constraint where conname='club_locations_id_organisation_key') then
    alter table public.club_locations add constraint club_locations_id_organisation_key unique (id, organisation_id);
  end if;
end $$;

alter table public.club_members add column if not exists preferred_location_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='club_members_preferred_location_fk') then
    alter table public.club_members add constraint club_members_preferred_location_fk foreign key (preferred_location_id, organisation_id) references public.club_locations(id, organisation_id);
  end if;
end $$;

create index if not exists club_members_preferred_location_idx on public.club_members(organisation_id, preferred_location_id);
comment on column public.club_members.preferred_location_id is 'Optional home/preferred gym. This preference never narrows membership entitlement scope.';

-- Canonical organisation-level evaluation. `locations`/`organisation` grants with
-- non-empty location_ids are assignment-time snapshots; future_locations remains
-- dynamically expansive. Empty organisation arrays retain legacy org-wide meaning.
create or replace function public.club_evaluate_member_access(p_organisation_id uuid,p_user_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_has_membership boolean; v_has_future_membership boolean; v_has_expired boolean; v_policy_future boolean:=false; v_has_valid boolean:=false; v_org_wide boolean:=false; v_locations uuid[]:='{}'; v_grant record; v_policy text; v_active_location boolean;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.starts_at>p_at), exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.ends_at is not null and m.ends_at<=p_at) into v_has_membership,v_has_future_membership,v_has_expired;
  for v_grant in select g.* from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id loop
    v_has_valid:=true;
    if v_grant.scope='future_locations' then v_policy_future:=true; elsif v_grant.scope='organisation' and coalesce(array_length(v_grant.location_ids,1),0)=0 then v_org_wide:=true; else v_locations:=v_locations||coalesce(v_grant.location_ids,'{}'); end if;
  end loop;
  select exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.active and (v_policy_future or v_org_wide or l.id=any(v_locations))) into v_active_location;
  v_policy:=case when v_policy_future then 'future_locations' when v_org_wide then 'organisation' when coalesce(array_length(v_locations,1),0)>0 then 'locations' else null end;
  return jsonb_build_object('state',case when v_has_valid and v_active_location then 'active' when v_has_membership and exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active') then 'needs_attention' else 'unavailable' end,'reason',case when not v_has_membership and not v_has_valid then 'no_membership' when v_has_future_membership and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_not_started' when v_has_expired and not v_has_valid then 'membership_expired' when v_has_membership and not exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at)) then 'membership_inactive' when not v_has_valid then 'gym_access_missing' else null end,'policy',v_policy,'permitted_location_ids',case when v_policy_future or v_org_wide then null else to_jsonb(v_locations) end,'has_valid_grant',v_has_valid);
end; $$;

create or replace function public.club_get_member_operational_profile(p_organisation_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_member public.club_members%rowtype; v_access jsonb;
begin
  if auth.uid() is null then raise exception 'Club authentication required' using errcode='42501'; end if;
  select * into v_member from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active;
  if not found then raise exception 'Club member not found' using errcode='P0002'; end if;
  if auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Club member profile is not permitted' using errcode='42501'; end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id);
  return jsonb_build_object('member',jsonb_build_object('id',v_member.id,'organisation_id',v_member.organisation_id,'user_id',v_member.user_id,'role',v_member.role,'active',v_member.active),'home_location',(select jsonb_build_object('id',l.id,'name',l.name,'active',l.active) from public.club_locations l where l.id=v_member.preferred_location_id and l.organisation_id=p_organisation_id),'customer',(select jsonb_build_object('id',c.id,'display_name',c.display_name,'email',c.email,'phone',c.phone,'status',c.status) from public.club_customers c where c.organisation_id=p_organisation_id and c.user_id=p_user_id),'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'product_id',m.product_id,'product_name',p.name,'status',m.status,'starts_at',m.starts_at,'ends_at',m.ends_at,'source',m.source,'holder_user_ids',(select coalesce(jsonb_agg(h.user_id),'[]'::jsonb) from public.club_membership_holders h where h.membership_id=m.id))) from public.club_memberships m join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id where m.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=m.id and h.user_id=p_user_id)),'[]'::jsonb),'entitlements',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'entitlement_key',g.entitlement_key,'scope',g.scope,'location_ids',g.location_ids,'starts_at',g.starts_at,'ends_at',g.ends_at,'source',g.source,'allowance_quantity',g.allowance_quantity,'allowance_period',g.allowance_period,'discount_percent',g.discount_percent,'discount_period',g.discount_period,'discount_max_uses',g.discount_max_uses)) from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id),'[]'::jsonb),'service_credits',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'credit_key',a.credit_key,'unit',a.unit,'status',a.status,'balance_quantity',coalesce((select sum(e.quantity_delta) from public.club_service_credit_entries e where e.account_id=a.id),0))) from public.club_service_credit_accounts a where a.organisation_id=p_organisation_id and (a.user_id=p_user_id or exists(select 1 from public.club_customers c where c.id=a.customer_id and c.user_id=p_user_id))),'[]'::jsonb),'access',v_access);
end; $$;

create or replace function public.club_list_member_summaries(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Member directory is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,'active',m.active,'display_name',coalesce(c.display_name,'Club member'),'email',c.email,'membership_name',current_membership.product_name,'membership_status',current_membership.status,'membership_ends_at',current_membership.ends_at,'home_location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,'access_state',(public.club_evaluate_member_access(p_organisation_id,m.user_id)->>'state')) order by coalesce(c.display_name,'Club member'),m.created_at) from public.club_members m left join public.club_customers c on c.organisation_id=m.organisation_id and c.user_id=m.user_id left join public.club_locations l on l.id=m.preferred_location_id and l.organisation_id=m.organisation_id left join lateral (select ms.id,p.name product_name,ms.status,ms.ends_at from public.club_memberships ms join public.club_products p on p.id=ms.product_id and p.organisation_id=ms.organisation_id where ms.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=ms.id and h.user_id=m.user_id) order by (ms.status='active') desc,ms.starts_at desc limit 1) current_membership on true where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;

create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location public.club_locations%rowtype; v_grant public.club_entitlement_grants%rowtype; v_access jsonb;
begin
  if auth.uid() is null then raise exception 'Club authentication required' using errcode='42501'; end if;
  if auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  if not found or not v_location.active then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_inactive'); end if;
  select g.* into v_grant from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) and (g.scope='future_locations' or (g.scope='organisation' and (coalesce(array_length(g.location_ids,1),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids))) order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id limit 1;
  if found then return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'membership_id',v_grant.membership_id,'source',v_grant.source,'valid_from',v_grant.starts_at,'valid_until',v_grant.ends_at,'access_policy',v_grant.scope); end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at);
  if coalesce((v_access->>'has_valid_grant')::boolean,false) then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_not_included'); end if;
  return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason',coalesce(v_access->>'reason','gym_access_missing'));
end; $$;

create or replace function public.club_set_member_home_location(p_organisation_id uuid,p_user_id uuid,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Home location update is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Home location is invalid' using errcode='22023'; end if;
  update public.club_members set preferred_location_id=p_location_id where organisation_id=p_organisation_id and user_id=p_user_id;
  return public.club_get_member_operational_profile(p_organisation_id,p_user_id);
end; $$;

revoke all on function public.club_evaluate_member_access(uuid,uuid,timestamptz) from public, authenticated;
revoke all on function public.club_get_member_operational_profile(uuid,uuid),public.club_list_member_summaries(uuid),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_set_member_home_location(uuid,uuid,uuid) from public;
grant execute on function public.club_get_member_operational_profile(uuid,uuid),public.club_list_member_summaries(uuid),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_set_member_home_location(uuid,uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-11-club-induction.sql ===
-- R12 Club induction/onboarding foundation (forward-only; review before execution).
-- No policies are enabled and no member completion/backfill rows are created here.

create table if not exists public.club_induction_policies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid,
  requirement text not null check (requirement in ('none','online_or_in_person','in_person')),
  grace_days integer not null default 0 check (grace_days >= 0),
  overdue_access text not null default 'hold' check (overdue_access in ('allow','hold')),
  appointment_extension_enabled boolean not null default false,
  max_appointment_extension_days integer check (max_appointment_extension_days is null or max_appointment_extension_days >= 0),
  requires_reacknowledgement boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id)
);
create unique index if not exists club_induction_policies_scope_key on public.club_induction_policies (organisation_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.club_induction_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.club_induction_policies(id) on delete cascade,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','published')),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (policy_id, version),
  unique (id, organisation_id),
  foreign key (policy_id, organisation_id) references public.club_induction_policies(id, organisation_id)
);
create index if not exists club_induction_versions_current_idx on public.club_induction_versions (policy_id, status, effective_at desc);

create table if not exists public.club_induction_content_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.club_induction_versions(id) on delete cascade,
  position integer not null check (position >= 0),
  section_key text not null,
  title text not null,
  content text not null,
  requires_acknowledgement boolean not null default true,
  unique (version_id, position),
  unique (version_id, section_key)
);

create table if not exists public.club_member_induction_completions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  policy_id uuid not null references public.club_induction_policies(id),
  version_id uuid not null references public.club_induction_versions(id),
  route text not null check (route in ('online','in_person')),
  acknowledgement_version text not null,
  completed_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (policy_id, organisation_id) references public.club_induction_policies(id, organisation_id),
  foreign key (version_id, organisation_id) references public.club_induction_versions(id, organisation_id)
);
create index if not exists club_member_induction_completions_lookup_idx on public.club_member_induction_completions (organisation_id, user_id, policy_id, completed_at desc);

create table if not exists public.club_induction_bookings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  location_id uuid not null,
  policy_id uuid not null,
  version_id uuid references public.club_induction_versions(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'booked' check (status in ('booked','completed','cancelled','no_show')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_by uuid references auth.users(id),
  foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id),
  foreign key (policy_id, organisation_id) references public.club_induction_policies(id, organisation_id),
  foreign key (version_id, organisation_id) references public.club_induction_versions(id, organisation_id)
);
create index if not exists club_induction_bookings_member_idx on public.club_induction_bookings (organisation_id, user_id, status, starts_at);
create unique index if not exists club_induction_bookings_one_active_idx on public.club_induction_bookings (organisation_id, user_id, policy_id) where status = 'booked';

alter table public.club_induction_policies enable row level security;
alter table public.club_induction_versions enable row level security;
alter table public.club_induction_content_sections enable row level security;
alter table public.club_member_induction_completions enable row level security;
alter table public.club_induction_bookings enable row level security;
revoke all on public.club_induction_policies, public.club_induction_versions, public.club_induction_content_sections, public.club_member_induction_completions, public.club_induction_bookings from public, anon, authenticated;

create or replace function public.club_get_member_induction_state(p_organisation_id uuid,p_user_id uuid,p_location_id uuid default null,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_policy record; v_version record; v_booking record; v_completion record; v_anchor timestamptz; v_due timestamptz; v_until timestamptz; v_state text; v_route text; v_available_routes text[]; v_days integer; v_access jsonb; v_has_access boolean:=false;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Induction state is not permitted' using errcode='42501'; end if;
  select p.* into v_policy from public.club_induction_policies p where p.organisation_id=p_organisation_id and p.active and (p.location_id=p_location_id or (p.location_id is null and p_location_id is null) or (p.location_id is null and p_location_id is not null and not exists(select 1 from public.club_induction_policies specific where specific.organisation_id=p_organisation_id and specific.location_id=p_location_id and specific.active))) order by (p.location_id is not null) desc limit 1;
  if not found or v_policy.requirement='none' then return jsonb_build_object('sections','[]'::jsonb,'state',jsonb_build_object('state','not_required','required',false,'access_effect','none')); end if;
  select v.* into v_version from public.club_induction_versions v where v.policy_id=v_policy.id and v.status='published' and v.effective_at<=p_at order by v.effective_at desc,v.version desc limit 1;
  -- A configured policy without a published, effective version is not enforceable:
  -- do not create an impossible lockout before the gym has published content.
  if not found then return jsonb_build_object('policy',jsonb_build_object('id',v_policy.id,'organisation_id',v_policy.organisation_id,'location_id',v_policy.location_id,'requirement',v_policy.requirement,'grace_days',v_policy.grace_days,'overdue_access',v_policy.overdue_access,'appointment_extension_enabled',v_policy.appointment_extension_enabled,'max_appointment_extension_days',v_policy.max_appointment_extension_days,'requires_reacknowledgement',v_policy.requires_reacknowledgement,'active',v_policy.active,'created_at',v_policy.created_at,'updated_at',v_policy.updated_at),'sections','[]'::jsonb,'state',jsonb_build_object('state','not_required','required',false,'access_effect','none','requirement',v_policy.requirement)); end if;
  if p_location_id is not null then v_access:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,p_at); v_has_access:=coalesce((v_access->>'allowed')::boolean,false); else v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at); v_has_access:=coalesce((v_access->>'state')='active',false); end if;
  if not v_has_access then v_anchor:=p_at; else
    select max(case when g.membership_id is null then g.starts_at else greatest(g.starts_at,m.starts_at) end) into v_anchor
    from public.club_entitlement_grants g left join public.club_memberships m on m.id=g.membership_id and m.organisation_id=p_organisation_id
    where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at)
      and (g.membership_id is null or (m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at) and exists(select 1 from public.club_membership_holders h where h.membership_id=m.id and h.user_id=p_user_id)))
      and (p_location_id is null or g.scope='future_locations' or (g.scope='organisation' and (coalesce(array_length(g.location_ids,1),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids)));
  end if;
  v_anchor:=greatest(coalesce(v_anchor,p_at),v_version.effective_at); v_due:=v_anchor+(v_policy.grace_days||' days')::interval;
  v_available_routes:=case when v_policy.requirement='in_person' then array['in_person']::text[] else array['online','in_person']::text[] end;
  v_route:=null;
  if v_version.id is not null then select c.* into v_completion from public.club_member_induction_completions c where c.organisation_id=p_organisation_id and c.user_id=p_user_id and c.policy_id=v_policy.id and (c.version_id=v_version.id or not v_policy.requires_reacknowledgement) order by c.completed_at desc limit 1; end if;
  select b.* into v_booking from public.club_induction_bookings b where b.organisation_id=p_organisation_id and b.user_id=p_user_id and b.policy_id=v_policy.id and b.status='booked' and b.starts_at>p_at order by b.starts_at limit 1;
  if v_completion.id is not null then v_state:='complete'; v_route:=v_completion.route; elsif v_booking.id is not null and v_policy.appointment_extension_enabled and (v_policy.max_appointment_extension_days is null or v_booking.starts_at<=v_due+(v_policy.max_appointment_extension_days||' days')::interval) then v_state:='booked'; v_route:='in_person'; elsif p_at<v_due then v_state:='due'; else v_state:='overdue'; end if;
  v_until:=case when v_state='booked' then case when v_policy.max_appointment_extension_days is null then v_booking.starts_at else least(v_booking.starts_at,v_due+(v_policy.max_appointment_extension_days||' days')::interval) end else null end;
  v_days:=greatest(0,ceil(extract(epoch from (v_due-p_at))/86400))::integer;
  return jsonb_build_object('policy',jsonb_build_object('id',v_policy.id,'organisation_id',v_policy.organisation_id,'location_id',v_policy.location_id,'requirement',v_policy.requirement,'grace_days',v_policy.grace_days,'overdue_access',v_policy.overdue_access,'appointment_extension_enabled',v_policy.appointment_extension_enabled,'max_appointment_extension_days',v_policy.max_appointment_extension_days,'requires_reacknowledgement',v_policy.requires_reacknowledgement,'active',v_policy.active,'created_at',v_policy.created_at,'updated_at',v_policy.updated_at),'version',jsonb_build_object('id',v_version.id,'policy_id',v_version.policy_id,'organisation_id',v_version.organisation_id,'version',v_version.version,'status',v_version.status,'effective_at',v_version.effective_at,'created_at',v_version.created_at,'published_at',v_version.published_at),'sections',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version_id',s.version_id,'position',s.position,'section_key',s.section_key,'title',s.title,'content',s.content,'requires_acknowledgement',s.requires_acknowledgement) order by s.position) from public.club_induction_content_sections s where s.version_id=v_version.id),'[]'::jsonb),'state',jsonb_build_object('state',v_state,'required',true,'route',v_route,'available_routes',v_available_routes,'policy_id',v_policy.id,'version_id',v_version.id,'due_at',v_due,'grace_remaining_days',v_days,'booking',case when v_booking.id is null then null else jsonb_build_object('id',v_booking.id,'organisation_id',v_booking.organisation_id,'user_id',v_booking.user_id,'location_id',v_booking.location_id,'version_id',v_booking.version_id,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'status',v_booking.status,'created_at',v_booking.created_at,'completed_at',v_booking.completed_at,'verified_by',v_booking.verified_by) end,'completed_at',v_completion.completed_at,'verified_by',v_completion.verified_by,'access_effect',case when v_state='overdue' and v_policy.overdue_access='hold' then 'hold' when v_state in ('due','booked') then 'warn' else 'none' end,'requirement',v_policy.requirement,'extension_until',v_until));
end; $$;

create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_base jsonb; v_induction jsonb;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  v_base:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,p_at);
  if v_base->>'allowed' <> 'true' then return v_base; end if;
  v_induction:=public.club_get_member_induction_state(p_organisation_id,p_user_id,p_location_id,p_at);
  if v_induction->'state'->>'access_effect'='hold' then return v_base||jsonb_build_object('allowed',false,'reason','induction_overdue','induction',v_induction->'state'); end if;
  return v_base||jsonb_build_object('induction',v_induction->'state');
end; $$;

create or replace function public.club_check_member_location_access_base(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_location public.club_locations%rowtype; v_grant public.club_entitlement_grants%rowtype; v_access jsonb;
begin
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id;
  if not found or not v_location.active then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_inactive'); end if;
  select g.* into v_grant from public.club_entitlement_grants g where g.organisation_id=p_organisation_id and g.user_id=p_user_id and g.entitlement_key='gym_access' and g.starts_at<=p_at and (g.ends_at is null or g.ends_at>p_at) and (g.membership_id is null or exists(select 1 from public.club_memberships m join public.club_membership_holders h on h.membership_id=m.id and h.user_id=p_user_id where m.id=g.membership_id and m.organisation_id=p_organisation_id and m.status='active' and m.starts_at<=p_at and (m.ends_at is null or m.ends_at>p_at))) and (g.scope='future_locations' or (g.scope='organisation' and (coalesce(array_length(g.location_ids,1),0)=0 or p_location_id=any(g.location_ids))) or (g.scope='locations' and p_location_id=any(g.location_ids))) order by (g.scope='future_locations') desc,(g.scope='organisation' and coalesce(array_length(g.location_ids,1),0)=0) desc,g.ends_at nulls first,g.starts_at desc,g.id limit 1;
  if found then return jsonb_build_object('allowed',true,'organisation_id',p_organisation_id,'location_id',p_location_id,'membership_id',v_grant.membership_id,'source',v_grant.source,'valid_from',v_grant.starts_at,'valid_until',v_grant.ends_at,'access_policy',v_grant.scope); end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,p_at);
  if coalesce((v_access->>'has_valid_grant')::boolean,false) then return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','location_not_included'); end if;
  return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason',coalesce(v_access->>'reason','gym_access_missing'));
end; $$;

create or replace function public.club_complete_online_induction(p_organisation_id uuid,p_user_id uuid,p_version_id uuid,p_acknowledgement_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_version record; v_policy record; v_access jsonb;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'Online induction is not permitted' using errcode='42501'; end if;
  select v.*,p.requirement,p.active policy_active,p.requires_reacknowledgement into v_version from public.club_induction_versions v join public.club_induction_policies p on p.id=v.policy_id and p.organisation_id=v.organisation_id where v.id=p_version_id and v.organisation_id=p_organisation_id and v.status='published' and v.effective_at<=now() and p.active and p.requirement='online_or_in_person';
  if not found or nullif(trim(p_acknowledgement_version),'') is null or p_acknowledgement_version<>v_version.version::text then raise exception 'Online induction is invalid' using errcode='22023'; end if;
  v_access:=public.club_evaluate_member_access(p_organisation_id,p_user_id,now());
  if coalesce((v_access->>'state')<>'active',true) then raise exception 'Online induction is not applicable' using errcode='42501'; end if;
  insert into public.club_member_induction_completions(organisation_id,user_id,policy_id,version_id,route,acknowledgement_version) values(p_organisation_id,p_user_id,v_version.policy_id,p_version_id,'online',p_acknowledgement_version);
  return public.club_get_member_induction_state(p_organisation_id,p_user_id,null,now());
end; $$;

create or replace function public.club_book_induction(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_version_id uuid,p_starts_at timestamptz,p_ends_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_policy record; v_version record; v_booking public.club_induction_bookings%rowtype; v_access jsonb; v_location public.club_locations%rowtype;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'Induction booking is not permitted' using errcode='42501'; end if;
  select * into v_location from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active;
  if not found then raise exception 'Induction booking location is invalid' using errcode='22023'; end if;
  select p.* into v_policy from public.club_induction_policies p where p.organisation_id=p_organisation_id and p.active and p.requirement in ('in_person','online_or_in_person') and (p.location_id=p_location_id or p.location_id is null) order by (p.location_id is not null) desc limit 1;
  if not found or p_version_id is null then raise exception 'Induction booking is invalid' using errcode='22023'; end if;
  select v.* into v_version from public.club_induction_versions v where v.id=p_version_id and v.policy_id=v_policy.id and v.organisation_id=p_organisation_id and v.status='published' and v.effective_at<=now();
  if not found or p_starts_at<=now() or p_ends_at<=p_starts_at then raise exception 'Induction booking is invalid' using errcode='22023'; end if;
  v_access:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,now());
  if coalesce((v_access->>'allowed')::boolean,false)=false then raise exception 'Induction booking is not applicable' using errcode='42501'; end if;
  insert into public.club_induction_bookings(organisation_id,user_id,location_id,policy_id,version_id,starts_at,ends_at,created_by) values(p_organisation_id,p_user_id,p_location_id,v_policy.id,p_version_id,p_starts_at,p_ends_at,p_user_id) returning * into v_booking;
  return jsonb_build_object('id',v_booking.id,'organisation_id',v_booking.organisation_id,'user_id',v_booking.user_id,'location_id',v_booking.location_id,'version_id',v_booking.version_id,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'status',v_booking.status,'created_at',v_booking.created_at);
end; $$;

create or replace function public.club_reconcile_induction_booking(p_organisation_id uuid,p_booking_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_booking public.club_induction_bookings%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'induction.perform') then raise exception 'Induction verification is not permitted' using errcode='42501'; end if;
  if p_status not in ('completed','cancelled','no_show') then raise exception 'Induction booking status is invalid' using errcode='22023'; end if;
  select * into v_booking from public.club_induction_bookings where id=p_booking_id and organisation_id=p_organisation_id for update;
  if not found or v_booking.status<>'booked' or not public.club_location_authorized(p_organisation_id,v_booking.location_id) then raise exception 'Induction booking is invalid' using errcode='22023'; end if;
  update public.club_induction_bookings set status=p_status, completed_at=case when p_status='completed' then now() else null end, verified_by=auth.uid() where id=p_booking_id returning * into v_booking;
  if p_status='completed' then insert into public.club_member_induction_completions(organisation_id,user_id,policy_id,version_id,route,acknowledgement_version,verified_by,completed_at) values(v_booking.organisation_id,v_booking.user_id,v_booking.policy_id,v_booking.version_id,'in_person',coalesce(v_booking.version_id::text,'in_person'),auth.uid(),now()); end if;
  return jsonb_build_object('id',v_booking.id,'organisation_id',v_booking.organisation_id,'user_id',v_booking.user_id,'location_id',v_booking.location_id,'version_id',v_booking.version_id,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'status',v_booking.status,'created_at',v_booking.created_at,'completed_at',v_booking.completed_at,'verified_by',v_booking.verified_by);
end; $$;

create or replace function public.club_save_induction_policy(p_id uuid,p_organisation_id uuid,p_location_id uuid,p_requirement text,p_grace_days integer,p_overdue_access text,p_appointment_extension_enabled boolean,p_max_appointment_extension_days integer,p_requires_reacknowledgement boolean,p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_policy public.club_induction_policies%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Induction policy management is not permitted' using errcode='42501'; end if;
  if p_requirement not in ('none','online_or_in_person','in_person') or p_grace_days<0 or p_overdue_access not in ('allow','hold') or (p_max_appointment_extension_days is not null and p_max_appointment_extension_days<0) then raise exception 'Induction policy is invalid' using errcode='22023'; end if;
  if p_id is null then insert into public.club_induction_policies(organisation_id,location_id,requirement,grace_days,overdue_access,appointment_extension_enabled,max_appointment_extension_days,requires_reacknowledgement,active,created_by) values(p_organisation_id,p_location_id,p_requirement,p_grace_days,p_overdue_access,p_appointment_extension_enabled,p_max_appointment_extension_days,p_requires_reacknowledgement,p_active,auth.uid()) returning * into v_policy; else update public.club_induction_policies set location_id=p_location_id,requirement=p_requirement,grace_days=p_grace_days,overdue_access=p_overdue_access,appointment_extension_enabled=p_appointment_extension_enabled,max_appointment_extension_days=p_max_appointment_extension_days,requires_reacknowledgement=p_requires_reacknowledgement,active=p_active,updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_policy; if not found then raise exception 'Induction policy not found' using errcode='P0002'; end if; end if;
  return jsonb_build_object('id',v_policy.id,'organisation_id',v_policy.organisation_id,'location_id',v_policy.location_id,'requirement',v_policy.requirement,'grace_days',v_policy.grace_days,'overdue_access',v_policy.overdue_access,'appointment_extension_enabled',v_policy.appointment_extension_enabled,'max_appointment_extension_days',v_policy.max_appointment_extension_days,'requires_reacknowledgement',v_policy.requires_reacknowledgement,'active',v_policy.active,'created_at',v_policy.created_at,'updated_at',v_policy.updated_at);
end; $$;

create or replace function public.club_save_induction_version(p_id uuid,p_organisation_id uuid,p_policy_id uuid,p_version integer,p_status text,p_effective_at timestamptz,p_sections jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_version public.club_induction_versions%rowtype; v_section jsonb; v_position integer:=0;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Induction content management is not permitted' using errcode='42501'; end if;
  if p_status not in ('draft','published') or p_version<1 or jsonb_typeof(coalesce(p_sections,'[]'::jsonb))<>'array' or not exists(select 1 from public.club_induction_policies where id=p_policy_id and organisation_id=p_organisation_id) then raise exception 'Induction version is invalid' using errcode='22023'; end if;
  if p_id is null then insert into public.club_induction_versions(policy_id,organisation_id,version,status,effective_at,published_at) values(p_policy_id,p_organisation_id,p_version,p_status,p_effective_at,case when p_status='published' then now() else null end) returning * into v_version; else update public.club_induction_versions set policy_id=p_policy_id,version=p_version,status=p_status,effective_at=p_effective_at,published_at=case when p_status='published' then coalesce(published_at,now()) else null end where id=p_id and organisation_id=p_organisation_id returning * into v_version; if not found then raise exception 'Induction version not found' using errcode='P0002'; end if; end if;
  delete from public.club_induction_content_sections where version_id=v_version.id;
  for v_section in select value from jsonb_array_elements(p_sections) loop
    insert into public.club_induction_content_sections(version_id,position,section_key,title,content,requires_acknowledgement) values(v_version.id,v_position,coalesce(v_section->>'sectionKey',v_section->>'section_key','section-'||v_position),coalesce(v_section->>'title',''),coalesce(v_section->>'content',''),coalesce((v_section->>'requiresAcknowledgement')::boolean,(v_section->>'requires_acknowledgement')::boolean,true)); v_position:=v_position+1;
  end loop;
  return jsonb_build_object('id',v_version.id,'policy_id',v_version.policy_id,'organisation_id',v_version.organisation_id,'version',v_version.version,'status',v_version.status,'effective_at',v_version.effective_at,'created_at',v_version.created_at,'published_at',v_version.published_at);
end; $$;

-- The base helper and evaluator are internal SECURITY DEFINER implementation details.
-- They must never be callable by a browser role; only the checked public wrappers below are exposed.
revoke all on function public.club_check_member_location_access_base(uuid,uuid,uuid,timestamptz),public.club_evaluate_member_access(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.club_get_member_induction_state(uuid,uuid,uuid,timestamptz),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_complete_online_induction(uuid,uuid,uuid,text),public.club_book_induction(uuid,uuid,uuid,uuid,timestamptz,timestamptz),public.club_reconcile_induction_booking(uuid,uuid,text),public.club_save_induction_policy(uuid,uuid,uuid,text,integer,text,boolean,integer,boolean,boolean),public.club_save_induction_version(uuid,uuid,uuid,integer,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.club_get_member_induction_state(uuid,uuid,uuid,timestamptz),public.club_check_member_location_access(uuid,uuid,uuid,timestamptz),public.club_complete_online_induction(uuid,uuid,uuid,text),public.club_book_induction(uuid,uuid,uuid,uuid,timestamptz,timestamptz),public.club_reconcile_induction_booking(uuid,uuid,text),public.club_save_induction_policy(uuid,uuid,uuid,text,integer,text,boolean,integer,boolean,boolean),public.club_save_induction_version(uuid,uuid,uuid,integer,text,timestamptz,jsonb) to authenticated;


-- === APPLY supabase/migrations/2026-09-12-club-membership-lifecycle.sql ===
-- Guest-capable membership lifecycle. Manual review only; never execute from the app.
alter table public.club_membership_holders add column if not exists id uuid default gen_random_uuid();
alter table public.club_membership_holders add column if not exists organisation_id uuid;
alter table public.club_membership_holders add column if not exists customer_id uuid;
update public.club_membership_holders h set organisation_id = m.organisation_id from public.club_memberships m where m.id = h.membership_id and h.organisation_id is null;
update public.club_membership_holders set id = gen_random_uuid() where id is null;
alter table public.club_membership_holders alter column organisation_id set not null;
alter table public.club_membership_holders drop constraint if exists club_membership_holders_pkey;
alter table public.club_membership_holders alter column user_id drop not null;
alter table public.club_membership_holders add constraint club_membership_holders_pkey primary key (id);
alter table public.club_membership_holders add constraint club_membership_holders_identity_chk check (num_nonnulls(user_id, customer_id) = 1);
alter table public.club_membership_holders add constraint club_membership_holders_membership_org_fk foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete cascade;
alter table public.club_membership_holders add constraint club_membership_holders_customer_org_fk foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete cascade;
create unique index if not exists club_membership_holders_user_uq on public.club_membership_holders(membership_id, user_id) where user_id is not null;
create unique index if not exists club_membership_holders_customer_uq on public.club_membership_holders(membership_id, customer_id) where customer_id is not null;
alter table public.club_memberships add column if not exists assignment_idempotency_key text;
alter table public.club_memberships add column if not exists ended_at timestamptz;
alter table public.club_memberships add column if not exists ended_by uuid references auth.users(id);
alter table public.club_memberships add column if not exists end_reason text;
alter table public.club_memberships add column if not exists end_requested_at timestamptz;
alter table public.club_memberships add column if not exists end_requested_by uuid references auth.users(id);
create unique index if not exists club_memberships_assignment_key_uq on public.club_memberships(organisation_id, assignment_idempotency_key) where assignment_idempotency_key is not null;

create or replace function public.club_assign_membership(p_organisation_id uuid, p_product_id uuid, p_customer_id uuid, p_holder_user_ids uuid[], p_starts_at timestamptz, p_ends_at timestamptz, p_source text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_product public.club_products%rowtype; v_customer public.club_customers%rowtype; v_membership public.club_memberships%rowtype; v_users uuid[]; v_existing public.club_memberships%rowtype; v_holders jsonb; v_grants jsonb;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Membership assignment is not permitted' using errcode='42501'; end if;
 select * into v_product from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
 if not found or v_product.archived_at is not null or v_product.kind <> 'membership' then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
 if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) or nullif(trim(p_idempotency_key),'') is null then raise exception 'Invalid membership assignment' using errcode='22023'; end if;
 if p_customer_id is null and coalesce(cardinality(p_holder_user_ids),0)=0 then raise exception 'At least one holder is required' using errcode='22023'; end if;
 if p_customer_id is not null then select * into v_customer from public.club_customers c where c.id=p_customer_id and c.organisation_id=p_organisation_id for share; if not found then raise exception 'Customer is not in this organisation' using errcode='42501'; end if; end if;
 select coalesce(array_agg(distinct x order by x),'{}') into v_users from unnest(coalesce(p_holder_user_ids,'{}')) x;
 if v_customer.user_id is not null then v_users := array(select distinct x from unnest(v_users || v_customer.user_id) x order by x); end if;
 if exists(select 1 from unnest(v_users) x where not exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=x and m.active)) then raise exception 'Every holder must be an active organisation member' using errcode='22023'; end if;
 select * into v_existing from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key=p_idempotency_key for update;
 if found then
   if v_existing.product_id<>p_product_id or v_existing.starts_at<>p_starts_at or v_existing.ends_at is distinct from p_ends_at or v_existing.source<>p_source or (p_customer_id is not null and v_customer.user_id is null and not exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.customer_id=p_customer_id)) or (p_customer_id is null and exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.customer_id is not null)) or exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null and not (h.user_id=any(v_users))) or (select count(*) from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null)<>cardinality(v_users) then raise exception 'Membership assignment idempotency conflict' using errcode='23505'; end if;
   select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_existing.id;
   select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_existing.id;
   return jsonb_build_object('membership',to_jsonb(v_existing),'holders',v_holders,'grants',v_grants);
 end if;
 insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key) values(p_organisation_id,p_product_id,'active',p_starts_at,p_ends_at,p_source,p_idempotency_key) returning * into v_membership;
 if p_customer_id is not null and v_customer.user_id is null then insert into public.club_membership_holders(id,membership_id,organisation_id,customer_id) values(gen_random_uuid(),v_membership.id,p_organisation_id,p_customer_id); end if;
 insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) select gen_random_uuid(),v_membership.id,p_organisation_id,x from unnest(v_users) x;
 insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
 select u,v_membership.organisation_id,v_membership.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,v_membership.starts_at,v_membership.ends_at,v_membership.source from unnest(v_users) u join public.club_product_entitlements e on e.product_id=v_product.id;
 select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_membership.id; select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_membership.id;
 return jsonb_build_object('membership',to_jsonb(v_membership),'holders',v_holders,'grants',v_grants);
end; $$;

create or replace function public.club_link_customer_user(p_customer_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog, public as $$
declare c public.club_customers%rowtype; h record; e public.club_product_entitlements%rowtype;
begin
 select * into c from public.club_customers where id=p_customer_id for update; if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
 if auth.uid() is null or not public.club_has_active_role(c.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Customer linking is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_members m where m.organisation_id=c.organisation_id and m.user_id=p_user_id and m.active) then raise exception 'User is not an active organisation member' using errcode='42501'; end if;
 if c.user_id is not null and c.user_id<>p_user_id then raise exception 'Customer is already linked' using errcode='23505'; end if;
 update public.club_customers set user_id=p_user_id,updated_at=now() where id=c.id returning * into c;
 for h in select m.*, p.id product_id from public.club_membership_holders holder join public.club_memberships m on m.id=holder.membership_id join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id where holder.customer_id=c.id loop
   if exists(select 1 from public.club_membership_holders existing where existing.membership_id=h.id and existing.user_id=p_user_id) then delete from public.club_membership_holders where membership_id=h.id and customer_id=c.id; else update public.club_membership_holders set user_id=p_user_id,customer_id=null where membership_id=h.id and customer_id=c.id; end if;
   insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source) select p_user_id,h.organisation_id,h.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,h.starts_at,h.ends_at,h.source from public.club_product_entitlements e where e.product_id=h.product_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=h.id and g.user_id=p_user_id and g.entitlement_key=e.entitlement_key);
 end loop; return to_jsonb(c);
end; $$;

create or replace function public.club_end_membership(p_organisation_id uuid,p_membership_id uuid,p_effective_at timestamptz,p_status text,p_reason text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog, public as $$
declare m public.club_memberships%rowtype; at timestamptz:=coalesce(p_effective_at,now());
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Membership ending is not permitted' using errcode='42501'; end if;
 select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update; if not found then raise exception 'Membership not found' using errcode='P0002'; end if;
 if p_status not in ('cancelled','expired') then raise exception 'Invalid membership end status' using errcode='22023'; end if;
 if m.ends_at is not null and m.ends_at<=at then return to_jsonb(m); end if;
 update public.club_memberships set ends_at=at, status=case when at<=now() then p_status else status end, ended_at=case when at<=now() then now() else ended_at end, ended_by=case when at<=now() then auth.uid() else ended_by end, end_requested_at=now(), end_requested_by=auth.uid(), end_reason=coalesce(p_reason,end_reason) where id=m.id returning * into m; return to_jsonb(m);
end; $$;

revoke all on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) from public,anon;
revoke all on function public.club_link_customer_user(uuid,uuid) from public,anon;
revoke all on function public.club_end_membership(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.club_link_customer_user(uuid,uuid) to authenticated;
grant execute on function public.club_end_membership(uuid,uuid,timestamptz,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-09-14-club-stock-reservations.sql ===
create table if not exists public.club_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null references public.club_locations(id) on delete restrict,
  product_id uuid not null references public.club_commerce_products(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  customer_id uuid references public.club_customers(id) on delete set null,
  order_id uuid not null references public.club_orders(id) on delete cascade,
  order_item_id uuid references public.club_order_items(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active','fulfilled','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists club_stock_reservations_balance_idx on public.club_stock_reservations(organisation_id,location_id,product_id,status);
create index if not exists club_stock_reservations_order_idx on public.club_stock_reservations(organisation_id,order_id,status);
create index if not exists club_stock_reservations_user_idx on public.club_stock_reservations(organisation_id,user_id,status);
alter table public.club_stock_reservations enable row level security;
revoke all on public.club_stock_reservations from public, anon, authenticated;

create or replace function public.club_reserve_order_stock(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_item public.club_order_items%rowtype; v_on_hand integer; v_reserved integer; v_available integer; v_existing integer; v_created integer:=0;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or (v_order.user_id is distinct from auth.uid() and not public.club_has_active_role(v_order.organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Order reservation is not permitted' using errcode='42501'; end if;
  if v_order.location_id is null then return jsonb_build_object('reserved',0); end if;
  for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    perform pg_advisory_xact_lock(hashtextextended(v_order.organisation_id::text||':'||v_order.location_id::text||':'||v_item.product_id::text,0));
    select coalesce(sum(quantity_delta),0) into v_on_hand from public.club_stock_movements where organisation_id=v_order.organisation_id and location_id=v_order.location_id and product_id=v_item.product_id;
    select coalesce(sum(quantity),0) into v_reserved from public.club_stock_reservations where organisation_id=v_order.organisation_id and location_id=v_order.location_id and product_id=v_item.product_id and status='active';
    select coalesce(sum(quantity),0) into v_existing from public.club_stock_reservations where order_id=v_order.id and order_item_id=v_item.id and status='active';
    v_available:=v_on_hand-v_reserved+v_existing;
    if v_available < v_item.quantity then raise exception 'Insufficient stock for reservation' using errcode='23514'; end if;
    if v_existing=0 then insert into public.club_stock_reservations(organisation_id,location_id,product_id,user_id,customer_id,order_id,order_item_id,quantity) values(v_order.organisation_id,v_order.location_id,v_item.product_id,v_order.user_id,v_order.customer_id,v_order.id,v_item.id,v_item.quantity); v_created:=v_created+1; end if;
  end loop;
  return jsonb_build_object('reserved',v_created);
end; $$;

create or replace function public.club_release_order_reservations(p_order_id uuid, p_status text default 'cancelled')
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_count integer;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or (v_order.user_id is distinct from auth.uid() and not public.club_has_active_role(v_order.organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Reservation release is not permitted' using errcode='42501'; end if;
  update public.club_stock_reservations set status=case when p_status='fulfilled' then 'fulfilled' else 'cancelled' end, updated_at=now(), fulfilled_at=case when p_status='fulfilled' then now() else fulfilled_at end, cancelled_at=case when p_status='fulfilled' then cancelled_at else now() end where order_id=p_order_id and status='active'; get diagnostics v_count=row_count; return v_count;
end; $$;

create or replace function public.club_stock_reservation_order_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status in ('cancelled','refunded') and old.status is distinct from new.status then update public.club_stock_reservations set status='cancelled',updated_at=now(),cancelled_at=now() where order_id=new.id and status='active'; end if;
  return new;
end; $$;
drop trigger if exists club_stock_reservation_order_status on public.club_orders;
create trigger club_stock_reservation_order_status after update of status on public.club_orders for each row execute function public.club_stock_reservation_order_trigger();

create or replace function public.club_stock_reservation_sale_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.movement_type='sale' and new.order_id is not null then update public.club_stock_reservations set status='fulfilled',updated_at=now(),fulfilled_at=now() where order_id=new.order_id and product_id=new.product_id and status='active'; end if;
  return new;
end; $$;
drop trigger if exists club_stock_reservation_sale on public.club_stock_movements;
create trigger club_stock_reservation_sale after insert on public.club_stock_movements for each row execute function public.club_stock_reservation_sale_trigger();
revoke all on function public.club_reserve_order_stock(uuid), public.club_release_order_reservations(uuid,text) from public, anon;
grant execute on function public.club_reserve_order_stock(uuid), public.club_release_order_reservations(uuid,text) to authenticated;


-- === APPLY supabase/migrations/2026-09-22-club-supplier-commerce.sql ===
-- Supplier catalogue and order-to-collection domain.
create table if not exists public.club_suppliers (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  name text not null, active boolean not null default true, ordering_config jsonb not null default '{}'::jsonb,
  delivery_config jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists club_suppliers_org_name_uq on public.club_suppliers(organisation_id, lower(name));
create table if not exists public.club_supplier_products (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade, club_product_id uuid references public.club_commerce_products(id) on delete set null, supplier_sku text, barcode text, brand text,
  name text not null, variant text, size text, description text, category text, wholesale_cost_minor integer, supplied_vat_rate numeric,
  supplier_rrp_minor integer, supplier_availability integer, image_url text, supplier_url text, discontinued boolean not null default false,
  sellable boolean not null default false, fulfilment_type text not null default 'supplier_order_for_collection', retail_price_minor integer,
  source_metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint club_supplier_products_fulfilment_ck check (fulfilment_type in ('stocked_at_location','supplier_order_for_collection','dropship'))
);
create unique index if not exists club_supplier_products_sku_uq on public.club_supplier_products(organisation_id,supplier_id,supplier_sku) where supplier_sku is not null;
-- Barcodes identify canonical Club products; multiple suppliers may offer one barcode.
create table if not exists public.club_supplier_import_batches (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade, file_name text not null, imported_by uuid not null references auth.users(id) on delete restrict,
  row_count integer not null default 0, created_count integer not null default 0, updated_count integer not null default 0,
  skipped_count integer not null default 0, invalid_count integer not null default 0, conflict_count integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.club_supplier_demand (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete restrict, supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict,
  order_id uuid not null references public.club_orders(id) on delete restrict, order_item_id uuid references public.club_order_items(id) on delete restrict, user_id uuid references auth.users(id) on delete set null, collection_location_id uuid references public.club_locations(id) on delete restrict,
  quantity_required integer not null check (quantity_required > 0), quantity_received integer not null default 0 check (quantity_received >= 0),
  quantity_allocated integer not null default 0 check (quantity_allocated >= 0), status text not null default 'outstanding', ordered_at timestamptz,
  received_at timestamptz, ready_at timestamptz, collected_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint club_supplier_demand_status_ck check (status in ('outstanding','ordered','awaiting_delivery','received','ready_for_collection','collected','cancelled'))
);
create unique index if not exists club_supplier_demand_order_item_uq on public.club_supplier_demand(order_item_id) where order_item_id is not null;
create table if not exists public.club_notification_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict, event_type text not null, order_id uuid references public.club_orders(id) on delete restrict, state text not null default 'queued', payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz, attempted_at timestamptz, provider text, provider_reference text, created_at timestamptz not null default now(),
  constraint club_notification_events_state_ck check (state in ('queued','sent','delivered','failed','retrying','manual_review'))
);
create unique index if not exists club_notification_ready_once_uq on public.club_notification_events(order_id,event_type) where event_type='order_ready_for_collection';
create table if not exists public.club_supplier_order_batches (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
 supplier_id uuid not null references public.club_suppliers(id) on delete restrict, status text not null default 'draft' check (status in ('draft','ordered','partially_received','received')),
 reference text not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 ordered_by uuid references auth.users(id), ordered_at timestamptz, exported_at timestamptz, notes text, updated_at timestamptz not null default now(), unique (organisation_id, reference)
);
create table if not exists public.club_supplier_order_batch_lines (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.club_supplier_order_batches(id) on delete restrict,
 supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict, quantity_ordered integer not null check(quantity_ordered>0),
 created_at timestamptz not null default now(), unique(batch_id,supplier_product_id)
);
alter table public.club_supplier_demand add column if not exists batch_id uuid references public.club_supplier_order_batches(id) on delete restrict;
alter table public.club_supplier_order_batch_lines enable row level security; alter table public.club_supplier_order_batches enable row level security;
revoke all on public.club_supplier_order_batches,public.club_supplier_order_batch_lines from anon,authenticated;

alter table public.club_suppliers enable row level security; alter table public.club_supplier_products enable row level security;
alter table public.club_supplier_import_batches enable row level security; alter table public.club_supplier_demand enable row level security; alter table public.club_notification_events enable row level security;
-- Access is intentionally via capability-checked server functions; no browser table grants are added here.
revoke all on public.club_suppliers, public.club_supplier_products, public.club_supplier_import_batches, public.club_supplier_demand, public.club_notification_events from anon, authenticated;

create or replace function public.club_import_supplier_catalogue(p_organisation_id uuid, p_supplier_name text, p_file_name text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_supplier uuid; v_batch uuid; v_row jsonb; v_product uuid; v_created integer:=0; v_updated integer:=0; v_conflicts integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier catalogue import is not permitted' using errcode='42501'; end if;
  if p_organisation_id is null or nullif(btrim(p_supplier_name),'') is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then raise exception 'Invalid supplier import' using errcode='22023'; end if;
  insert into public.club_suppliers(organisation_id,name) values(p_organisation_id,btrim(p_supplier_name)) on conflict (organisation_id,lower(name)) do update set active=true,updated_at=now() returning id into v_supplier;
  insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count) values(p_organisation_id,v_supplier,coalesce(nullif(btrim(p_file_name),''),'supplier.csv'),auth.uid(),jsonb_array_length(coalesce(p_rows,'[]'::jsonb))) returning id into v_batch;
  for v_row in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    if nullif(btrim(v_row->>'name'),'') is null then update public.club_supplier_import_batches set invalid_count=invalid_count+1 where id=v_batch; continue; end if;
    v_product := null;
    if nullif(btrim(v_row->>'supplierSku'),'') is not null then select id into v_product from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=v_supplier and supplier_sku=btrim(v_row->>'supplierSku') limit 1; end if;
    if v_product is null then insert into public.club_supplier_products(organisation_id,supplier_id,supplier_sku,barcode,brand,name,variant,size,description,category,wholesale_cost_minor,supplier_rrp_minor,supplier_availability,image_url,supplier_url,discontinued) values(p_organisation_id,v_supplier,nullif(btrim(v_row->>'supplierSku'),''),nullif(btrim(v_row->>'barcode'),''),nullif(btrim(v_row->>'brand'),''),btrim(v_row->>'name'),nullif(btrim(v_row->>'variant'),''),nullif(btrim(v_row->>'size'),''),nullif(v_row->>'description',''),nullif(btrim(v_row->>'category'),''),nullif(v_row->>'wholesaleCostMinor','')::integer,nullif(v_row->>'rrpMinor','')::integer,nullif(v_row->>'availability','')::integer,nullif(v_row->>'imageUrl',''),nullif(v_row->>'supplierUrl',''),coalesce((v_row->>'discontinued')::boolean,false)) returning id into v_product; v_created:=v_created+1;
    else update public.club_supplier_products set barcode=nullif(btrim(v_row->>'barcode'),''),brand=nullif(btrim(v_row->>'brand'),''),name=btrim(v_row->>'name'),variant=nullif(btrim(v_row->>'variant'),''),size=nullif(btrim(v_row->>'size'),''),description=nullif(v_row->>'description',''),category=nullif(btrim(v_row->>'category'),''),wholesale_cost_minor=nullif(v_row->>'wholesaleCostMinor','')::integer,supplier_rrp_minor=nullif(v_row->>'rrpMinor','')::integer,supplier_availability=nullif(v_row->>'availability','')::integer,image_url=nullif(v_row->>'imageUrl',''),supplier_url=nullif(v_row->>'supplierUrl',''),discontinued=coalesce((v_row->>'discontinued')::boolean,false),updated_at=now() where id=v_product; v_updated:=v_updated+1; end if;
  end loop;
  update public.club_supplier_import_batches set created_count=v_created,updated_count=v_updated where id=v_batch;
  return jsonb_build_object('batchId',v_batch,'created',v_created,'updated',v_updated);
end; $$;
revoke all on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) from public,anon;
grant execute on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) to authenticated;

create or replace function public.club_create_supplier_demand_for_order(p_order_id uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order record; v_item record; v_offer record; v_count integer:=0;
begin
  select o.* into v_order from public.club_orders o where o.id=p_order_id and o.status in ('paid','fulfilled');
  if not found then return 0; end if;
  for v_item in select i.* from public.club_order_items i where i.order_id=p_order_id loop
    select count(*) as count into v_count from public.club_supplier_products sp where sp.organisation_id=v_order.organisation_id and sp.club_product_id=v_item.product_id and sp.sellable and not sp.discontinued and sp.fulfilment_type='supplier_order_for_collection';
    if v_count <> 1 then continue; end if;
    select sp.* into v_offer from public.club_supplier_products sp where sp.organisation_id=v_order.organisation_id and sp.club_product_id=v_item.product_id and sp.sellable and not sp.discontinued and sp.fulfilment_type='supplier_order_for_collection' limit 1;
    insert into public.club_supplier_demand(organisation_id,supplier_id,supplier_product_id,order_id,order_item_id,user_id,collection_location_id,quantity_required)
    values(v_order.organisation_id,v_offer.supplier_id,v_offer.id,v_order.id,v_item.id,v_order.user_id,v_order.location_id,v_item.quantity)
    on conflict (order_item_id) do nothing;
  end loop;
  return 1;
end; $$;
revoke all on function public.club_create_supplier_demand_for_order(uuid) from public,anon,authenticated;
create or replace function public.club_after_payment_supplier_demand() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin if new.status='paid' then perform public.club_create_supplier_demand_for_order(new.order_id); end if; return new; end; $$;
revoke all on function public.club_after_payment_supplier_demand() from public,anon,authenticated;
drop trigger if exists club_payments_supplier_demand on public.club_payments;
create trigger club_payments_supplier_demand after insert or update of status on public.club_payments for each row execute function public.club_after_payment_supplier_demand();

create or replace function public.club_list_supplier_demand(p_organisation_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'supplier_id',d.supplier_id,'supplier',s.name,'supplier_sku',sp.supplier_sku,'barcode',sp.barcode,'product',coalesce(cp.name,sp.name),'brand',coalesce(cp.brand,sp.brand),'variant',sp.variant,'quantity_required',d.quantity_required,'quantity_received',d.quantity_received,'quantity_allocated',d.quantity_allocated,'status',d.status,'order_reference',left(d.order_id::text,8),'collection_location',l.name) order by s.name,sp.name),'[]'::jsonb) from public.club_supplier_demand d join public.club_suppliers s on s.id=d.supplier_id join public.club_supplier_products sp on sp.id=d.supplier_product_id left join public.club_commerce_products cp on cp.id=sp.club_product_id left join public.club_locations l on l.id=d.collection_location_id where d.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage'); $$;
revoke all on function public.club_list_supplier_demand(uuid) from public,anon; grant execute on function public.club_list_supplier_demand(uuid) to authenticated;

alter table public.club_supplier_demand add column if not exists batch_id uuid references public.club_supplier_order_batches(id) on delete restrict;
alter table public.club_supplier_order_batches enable row level security; alter table public.club_supplier_order_batch_lines enable row level security;
revoke all on public.club_supplier_order_batches,public.club_supplier_order_batch_lines from anon,authenticated;

create or replace function public.club_list_supplier_order_batches(p_organisation_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'reference',b.reference,'supplier',s.name,'status',b.status,'created_at',b.created_at,'ordered_at',b.ordered_at,'lines',(select count(*) from public.club_supplier_order_batch_lines x where x.batch_id=b.id),'units',(select coalesce(sum(x.quantity_ordered),0) from public.club_supplier_order_batch_lines x where x.batch_id=b.id)) order by b.created_at desc),'[]'::jsonb) from public.club_supplier_order_batches b join public.club_suppliers s on s.id=b.supplier_id where b.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage'); $$;
revoke all on function public.club_list_supplier_order_batches(uuid) from public,anon; grant execute on function public.club_list_supplier_order_batches(uuid) to authenticated;

create or replace function public.club_mark_supplier_ordered(p_organisation_id uuid,p_batch_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare b public.club_supplier_order_batches%rowtype; begin if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if; select * into b from public.club_supplier_order_batches where id=p_batch_id and organisation_id=p_organisation_id for update; if not found then raise exception 'Supplier order not found' using errcode='P0002'; end if; if b.status='ordered' then return to_jsonb(b); end if; update public.club_supplier_order_batches set status='ordered',ordered_by=auth.uid(),ordered_at=now(),updated_at=now() where id=p_batch_id returning * into b; update public.club_supplier_demand set status='ordered',ordered_at=b.ordered_at,updated_at=now() where batch_id=p_batch_id and status='outstanding'; return to_jsonb(b); end; $$;
revoke all on function public.club_mark_supplier_ordered(uuid,uuid) from public,anon; grant execute on function public.club_mark_supplier_ordered(uuid,uuid) to authenticated;

create table if not exists public.club_supplier_order_counters (organisation_id uuid primary key references public.club_organisations(id) on delete cascade, next_value integer not null default 1);
create table if not exists public.club_supplier_receipts (id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, batch_id uuid not null references public.club_supplier_order_batches(id) on delete restrict, supplier_id uuid not null references public.club_suppliers(id) on delete restrict, received_by uuid not null references auth.users(id), received_at timestamptz not null default now(), idempotency_key text not null, notes text, created_at timestamptz not null default now(), unique(organisation_id,idempotency_key));
create table if not exists public.club_supplier_receipt_lines (id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.club_supplier_receipts(id) on delete restrict, batch_line_id uuid not null references public.club_supplier_order_batch_lines(id) on delete restrict, quantity_received integer not null check(quantity_received>0), notes text, created_at timestamptz not null default now());
create table if not exists public.club_supplier_allocations (id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, receipt_line_id uuid not null references public.club_supplier_receipt_lines(id) on delete restrict, demand_id uuid not null references public.club_supplier_demand(id) on delete restrict, quantity_allocated integer not null check(quantity_allocated>0), allocated_by uuid not null references auth.users(id), allocated_at timestamptz not null default now());
alter table public.club_supplier_order_counters enable row level security; alter table public.club_supplier_receipts enable row level security; alter table public.club_supplier_receipt_lines enable row level security; alter table public.club_supplier_allocations enable row level security;
revoke all on public.club_supplier_order_counters,public.club_supplier_receipts,public.club_supplier_receipt_lines,public.club_supplier_allocations from anon,authenticated;

create or replace function public.club_create_supplier_order_batch(p_organisation_id uuid,p_supplier_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare b public.club_supplier_order_batches%rowtype; l record; n integer; ref text; begin if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if; perform 1 from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null for update; if not found then raise exception 'No outstanding supplier demand' using errcode='P0002'; end if; insert into public.club_supplier_order_counters(organisation_id,next_value) values(p_organisation_id,2) on conflict(organisation_id) do update set next_value=club_supplier_order_counters.next_value+1 returning next_value-1 into n; ref:='SUP-'||to_char(now(),'YYYYMMDD')||'-'||lpad(n::text,4,'0'); insert into public.club_supplier_order_batches(organisation_id,supplier_id,reference,created_by) values(p_organisation_id,p_supplier_id,ref,auth.uid()) returning * into b; for l in select supplier_product_id,sum(quantity_required)::integer quantity from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null group by supplier_product_id loop insert into public.club_supplier_order_batch_lines(batch_id,supplier_product_id,quantity_ordered) values(b.id,l.supplier_product_id,l.quantity); update public.club_supplier_demand set batch_id=b.id,updated_at=now() where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null and supplier_product_id=l.supplier_product_id; end loop; return to_jsonb(b); end; $$;
revoke all on function public.club_create_supplier_order_batch(uuid,uuid) from public,anon; grant execute on function public.club_create_supplier_order_batch(uuid,uuid) to authenticated;

create or replace function public.club_receive_supplier_delivery(p_organisation_id uuid,p_batch_id uuid,p_idempotency_key text,p_lines jsonb,p_notes text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare b public.club_supplier_order_batches%rowtype; r public.club_supplier_receipts%rowtype; line jsonb; bl public.club_supplier_order_batch_lines%rowtype; remaining integer; qty integer; begin if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Supplier receiving is not permitted' using errcode='42501'; end if; if nullif(btrim(p_idempotency_key),'') is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Invalid receipt' using errcode='22023'; end if; select * into b from public.club_supplier_order_batches where id=p_batch_id and organisation_id=p_organisation_id for update; if not found or b.status='draft' then raise exception 'Supplier order is not receivable' using errcode='P0002'; end if; select * into r from public.club_supplier_receipts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(r); end if; insert into public.club_supplier_receipts(organisation_id,batch_id,supplier_id,received_by,idempotency_key,notes) values(p_organisation_id,b.id,b.supplier_id,auth.uid(),p_idempotency_key,p_notes) returning * into r; for line in select value from jsonb_array_elements(p_lines) loop qty:=coalesce((line->>'quantityReceived')::integer,0); select * into bl from public.club_supplier_order_batch_lines where id=(line->>'batchLineId')::uuid and batch_id=b.id for update; if not found or qty<1 then raise exception 'Invalid receipt line' using errcode='22023'; end if; select bl.quantity_ordered-coalesce(sum(rl.quantity_received),0) into remaining from public.club_supplier_receipt_lines rl where rl.batch_line_id=bl.id; if qty>remaining then raise exception 'Receipt exceeds ordered quantity' using errcode='22023'; end if; insert into public.club_supplier_receipt_lines(receipt_id,batch_line_id,quantity_received,notes) values(r.id,bl.id,qty,line->>'notes'); end loop; update public.club_supplier_order_batches set status=case when not exists(select 1 from public.club_supplier_order_batch_lines bl where bl.batch_id=b.id and bl.quantity_ordered>coalesce((select sum(quantity_received) from public.club_supplier_receipt_lines rl where rl.batch_line_id=bl.id),0)) then 'received' when exists(select 1 from public.club_supplier_receipt_lines rl join public.club_supplier_order_batch_lines bl on bl.id=rl.batch_line_id where bl.batch_id=b.id) then 'partially_received' else 'ordered' end,updated_at=now() where id=b.id; return to_jsonb(r); end; $$;
revoke all on function public.club_receive_supplier_delivery(uuid,uuid,text,jsonb,text) from public,anon; grant execute on function public.club_receive_supplier_delivery(uuid,uuid,text,jsonb,text) to authenticated;

create or replace function public.club_get_supplier_order_batch(p_organisation_id uuid,p_batch_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select jsonb_build_object('batch',to_jsonb(b),'supplier',s.name,'lines',coalesce((select jsonb_agg(jsonb_build_object('id',bl.id,'supplier_sku',sp.supplier_sku,'barcode',sp.barcode,'brand',sp.brand,'product',sp.name,'variant',sp.variant,'size',sp.size,'quantity',bl.quantity_ordered,'received',(select coalesce(sum(quantity_received),0) from public.club_supplier_receipt_lines where batch_line_id=bl.id)) order by sp.name) from public.club_supplier_order_batch_lines bl join public.club_supplier_products sp on sp.id=bl.supplier_product_id where bl.batch_id=b.id),'[]'::jsonb)) from public.club_supplier_order_batches b join public.club_suppliers s on s.id=b.supplier_id where b.id=p_batch_id and b.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage'); $$;
revoke all on function public.club_get_supplier_order_batch(uuid,uuid) from public,anon; grant execute on function public.club_get_supplier_order_batch(uuid,uuid) to authenticated;
create or replace function public.club_allocate_supplier_units(p_organisation_id uuid,p_receipt_line_id uuid,p_demand_id uuid,p_quantity integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare rl public.club_supplier_receipt_lines%rowtype; d public.club_supplier_demand%rowtype; used integer; ready boolean; begin if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') or p_quantity<1 then raise exception 'Supplier allocation is not permitted' using errcode='42501'; end if; select * into rl from public.club_supplier_receipt_lines where id=p_receipt_line_id for update; select * into d from public.club_supplier_demand where id=p_demand_id and organisation_id=p_organisation_id for update; if not found then raise exception 'Allocation target not found' using errcode='P0002'; end if; if not exists(select 1 from public.club_supplier_order_batch_lines bl join public.club_supplier_receipts r on r.batch_id=bl.batch_id where bl.id=rl.batch_line_id and r.organisation_id=p_organisation_id and bl.supplier_product_id=d.supplier_product_id and d.batch_id=bl.batch_id) then raise exception 'Allocation product or batch mismatch' using errcode='22023'; end if; select coalesce(sum(quantity_allocated),0) into used from public.club_supplier_allocations where receipt_line_id=rl.id; if used+p_quantity>rl.quantity_received or d.quantity_allocated+p_quantity>d.quantity_required then raise exception 'Allocation exceeds available quantity' using errcode='22023'; end if; insert into public.club_supplier_allocations(organisation_id,receipt_line_id,demand_id,quantity_allocated,allocated_by) values(p_organisation_id,rl.id,d.id,p_quantity,auth.uid()); update public.club_supplier_demand set quantity_allocated=quantity_allocated+p_quantity,quantity_received=quantity_received+p_quantity,updated_at=now() where id=d.id returning * into d; if d.quantity_allocated>=d.quantity_required then update public.club_supplier_demand set status='ready_for_collection',ready_at=coalesce(ready_at,now()),updated_at=now() where id=d.id; end if; select not exists(select 1 from public.club_supplier_demand x where x.order_id=d.order_id and x.status not in ('ready_for_collection','collected','cancelled')) into ready; if ready then insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,payload) values(p_organisation_id,d.user_id,'order_ready_for_collection',d.order_id,jsonb_build_object('state','queued')) on conflict(order_id,event_type) do nothing; end if; return to_jsonb(d); end; $$;
revoke all on function public.club_allocate_supplier_units(uuid,uuid,uuid,integer) from public,anon; grant execute on function public.club_allocate_supplier_units(uuid,uuid,uuid,integer) to authenticated;

-- Collection handover: customer allocation is reserved stock, never a free-stock movement.
alter table public.club_supplier_demand add column if not exists collected_by uuid references auth.users(id) on delete restrict;
create or replace function public.club_list_ready_collections(p_organisation_id uuid,p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('order_id',x.order_id,'order_reference',left(x.order_id::text,8),'member_name',coalesce(c.display_name,'Member'),'collection_location',coalesce(l.name,'Collection desk'),'ready_at',x.ready_at,'items_summary',x.items_summary) order by x.ready_at),'[]'::jsonb)
from (select d.order_id,d.user_id,d.collection_location_id,min(d.ready_at) ready_at,string_agg((coalesce(cp.name,sp.name)||' × '||d.quantity_required::text),', ' order by sp.name) items_summary
      from public.club_supplier_demand d join public.club_supplier_products sp on sp.id=d.supplier_product_id left join public.club_commerce_products cp on cp.id=sp.club_product_id
      where d.organisation_id=p_organisation_id and d.status='ready_for_collection' and (p_location_id is null or d.collection_location_id=p_location_id) group by d.order_id,d.user_id,d.collection_location_id) x
left join public.club_customers c on c.organisation_id=p_organisation_id and c.user_id=x.user_id
left join public.club_locations l on l.id=x.collection_location_id and l.organisation_id=p_organisation_id
where public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.collections_manage')
  and not exists (select 1 from public.club_supplier_demand pending where pending.organisation_id=p_organisation_id and pending.order_id=x.order_id and pending.status not in ('ready_for_collection','collected','cancelled'));
$$;
revoke all on function public.club_list_ready_collections(uuid,uuid) from public,anon; grant execute on function public.club_list_ready_collections(uuid,uuid) to authenticated;

create or replace function public.club_confirm_collection(p_organisation_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_count integer; v_ready integer; v_now timestamptz:=now();
begin
 if v_user is null or not public.club_capability_allowed(p_organisation_id,v_user,'commerce.collections_manage') then raise exception 'Collection access is not permitted' using errcode='42501'; end if;
 perform 1 from public.club_supplier_demand where organisation_id=p_organisation_id and order_id=p_order_id for update;
 select count(*) filter (where status in ('ready_for_collection','collected')), count(*) filter (where status='ready_for_collection') into v_count,v_ready from public.club_supplier_demand where organisation_id=p_organisation_id and order_id=p_order_id;
 if v_count=0 then raise exception 'Collection order not found' using errcode='P0002'; end if;
 if exists(select 1 from public.club_supplier_demand where organisation_id=p_organisation_id and order_id=p_order_id and status not in ('ready_for_collection','collected','cancelled')) then raise exception 'Order is not ready for collection' using errcode='22023'; end if;
 if v_ready=0 then return jsonb_build_object('status','already_collected','order_id',p_order_id); end if;
 update public.club_supplier_demand set status='collected',collected_at=coalesce(collected_at,v_now),collected_by=coalesce(collected_by,v_user),updated_at=v_now where organisation_id=p_organisation_id and order_id=p_order_id and status='ready_for_collection';
 return jsonb_build_object('status','collected','order_id',p_order_id,'collected_at',v_now,'collected_by',v_user);
end; $$;
revoke all on function public.club_confirm_collection(uuid,uuid) from public,anon; grant execute on function public.club_confirm_collection(uuid,uuid) to authenticated;

create or replace function public.club_list_member_supplier_fulfilment(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
with per_order as (
  select d.order_id,
    case when bool_and(d.status='collected') then 'collected'
         when bool_and(d.status in ('ready_for_collection','collected')) then 'ready_for_collection'
         when bool_or(d.status='ordered') then 'awaiting_delivery'
         else 'order_confirmed' end as status,
    max(d.ready_at) as ready_at,
    max(d.created_at) as created_at
  from public.club_supplier_demand d
  where d.organisation_id=p_organisation_id and d.user_id=p_user_id and auth.uid()=p_user_id
  group by d.order_id
)
select coalesce(jsonb_agg(jsonb_build_object('order_id',order_id,'status',status,'ready_at',ready_at) order by created_at desc),'[]'::jsonb)
from per_order;
$$;
revoke all on function public.club_list_member_supplier_fulfilment(uuid,uuid) from public,anon; grant execute on function public.club_list_member_supplier_fulfilment(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-23-club-supplier-capabilities.sql ===
-- Add supplier/collection capabilities to the canonical Club permission model.
-- This preserves deny/allow precedence, owner protection, and existing presets.
alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'));

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select case
    when auth.uid() is null or p_user_id is distinct from auth.uid() then false
    when p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then false
    when exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role='owner' and p_capability='staff.permissions_manage') then true
    when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='deny') then false
    when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='allow') then true
    else exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and (
      (m.role='owner' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'))
      or (m.role='gym_admin' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'))
      or (m.role='gym_staff' and p_capability in ('members.view','members.create','members.link_account','payments.take','payments.record_cash','cash.reconcile','supplier.receive','commerce.collections_manage'))
      or (m.role='trainer' and p_capability='members.view')))
  end;
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;

create or replace function public.club_save_staff_permission(p_organisation_id uuid,p_user_id uuid,p_capability text,p_decision text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_staff_permission_overrides%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Staff permissions require owner access' using errcode='42501'; end if;
 if p_decision not in ('allow','deny') then raise exception 'Invalid permission decision' using errcode='22023'; end if;
 if p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then raise exception 'Unknown capability' using errcode='22023'; end if;
 if p_capability='staff.permissions_manage' and p_decision='allow' and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='owner') then raise exception 'Owner capability cannot be granted to non-owner' using errcode='42501'; end if;
 if p_capability='staff.permissions_manage' and p_decision='deny' and p_user_id=auth.uid() then raise exception 'Owner administration cannot be denied to the acting owner' using errcode='42501'; end if;
 if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role in ('gym_staff','gym_admin','owner')) then raise exception 'Operational staff member not found' using errcode='P0002'; end if;
 insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by) values(p_organisation_id,p_user_id,p_capability,p_decision,auth.uid()) on conflict (organisation_id,user_id,capability) do update set decision=excluded.decision,created_by=excluded.created_by,created_at=now() returning * into r;
 insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata) select p_organisation_id,auth.uid(),m.role,'staff.permission_changed','staff',p_user_id,jsonb_build_object('capability',p_capability,'decision',p_decision) from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
 return to_jsonb(r);
end; $$;
revoke all on function public.club_save_staff_permission(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_save_staff_permission(uuid,uuid,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-09-24-club-supplier-catalogue-operations.sql ===
-- Operational supplier catalogue review, canonical linking and publication.
create or replace function public.club_list_supplier_catalogue(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',sp.id,'supplier_id',sp.supplier_id,'supplier',s.name,'supplier_sku',sp.supplier_sku,
  'barcode',sp.barcode,'brand',sp.brand,'name',sp.name,'variant',sp.variant,'size',sp.size,
  'category',sp.category,'wholesale_cost_minor',sp.wholesale_cost_minor,'supplier_rrp_minor',sp.supplier_rrp_minor,
  'supplier_availability',sp.supplier_availability,'discontinued',sp.discontinued,'sellable',sp.sellable,
  'fulfilment_type',sp.fulfilment_type,'retail_price_minor',sp.retail_price_minor,
  'club_product_id',sp.club_product_id,'club_product_name',cp.name
) order by s.name,sp.name),'[]'::jsonb)
from public.club_supplier_products sp join public.club_suppliers s on s.id=sp.supplier_id
left join public.club_commerce_products cp on cp.id=sp.club_product_id
where sp.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage');
$$;
revoke all on function public.club_list_supplier_catalogue(uuid) from public,anon; grant execute on function public.club_list_supplier_catalogue(uuid) to authenticated;

create or replace function public.club_publish_supplier_offer(p_organisation_id uuid,p_offer_id uuid,p_club_product_id uuid,p_retail_price_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype; product public.club_commerce_products%rowtype;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue publication is not permitted' using errcode='42501'; end if;
 if p_retail_price_minor is null or p_retail_price_minor<=0 then raise exception 'A positive retail price is required' using errcode='22023'; end if;
 select * into offer from public.club_supplier_products where id=p_offer_id and organisation_id=p_organisation_id for update;
 select * into product from public.club_commerce_products where id=p_club_product_id and organisation_id=p_organisation_id and active for update;
 if not found or offer.id is null or offer.discontinued then raise exception 'Product review is incomplete' using errcode='P0002'; end if;
 if exists(select 1 from public.club_supplier_products other where other.organisation_id=p_organisation_id and other.club_product_id=p_club_product_id and other.id<>p_offer_id and other.sellable and not other.discontinued and other.fulfilment_type='supplier_order_for_collection') then raise exception 'Choose one supplier offer for this product' using errcode='22023'; end if;
 update public.club_supplier_products set club_product_id=p_club_product_id,retail_price_minor=p_retail_price_minor,sellable=true,fulfilment_type='supplier_order_for_collection',updated_at=now() where id=p_offer_id returning * into offer;
 return jsonb_build_object('id',offer.id,'club_product_id',offer.club_product_id,'retail_price_minor',offer.retail_price_minor,'sellable',offer.sellable);
end; $$;
revoke all on function public.club_publish_supplier_offer(uuid,uuid,uuid,integer) from public,anon; grant execute on function public.club_publish_supplier_offer(uuid,uuid,uuid,integer) to authenticated;

create or replace function public.club_create_and_publish_supplier_product(p_organisation_id uuid,p_offer_id uuid,p_name text,p_brand text,p_category text,p_barcode text,p_retail_price_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype; product public.club_commerce_products%rowtype;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue publication is not permitted' using errcode='42501'; end if;
 if nullif(btrim(p_name),'') is null or p_retail_price_minor is null or p_retail_price_minor<=0 then raise exception 'Product name and positive retail price are required' using errcode='22023'; end if;
 select * into offer from public.club_supplier_products where id=p_offer_id and organisation_id=p_organisation_id and not discontinued for update;
 if not found then raise exception 'Supplier product not found' using errcode='P0002'; end if;
 insert into public.club_commerce_products(organisation_id,barcode,name,brand,category,active,stock_tracked,sell_price_minor,currency,media)
 values(p_organisation_id,nullif(btrim(p_barcode),''),btrim(p_name),nullif(btrim(p_brand),''),nullif(btrim(p_category),''),true,false,p_retail_price_minor,'GBP',null)
 returning * into product;
 update public.club_supplier_products set club_product_id=product.id,retail_price_minor=p_retail_price_minor,sellable=true,fulfilment_type='supplier_order_for_collection',updated_at=now() where id=offer.id;
 return jsonb_build_object('id',offer.id,'club_product_id',product.id,'retail_price_minor',p_retail_price_minor,'sellable',true);
end; $$;
revoke all on function public.club_create_and_publish_supplier_product(uuid,uuid,text,text,text,text,integer) from public,anon; grant execute on function public.club_create_and_publish_supplier_product(uuid,uuid,text,text,text,text,integer) to authenticated;


-- === APPLY supabase/migrations/2026-09-25-club-madhouse-balance.sql ===
-- Madhouse Balance operational top-ups and staff checkout settlement.
-- Execute only after the already-live Club commerce migrations.

create or replace function public.club_record_balance_cash_top_up(
  p_organisation_id uuid, p_location_id uuid, p_customer_id uuid,
  p_amount_minor integer, p_currency text, p_idempotency_key text, p_notes text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_customer public.club_customers%rowtype; v_account public.club_balance_accounts%rowtype; v_entry public.club_balance_entries%rowtype; v_existing public.club_balance_entries%rowtype;
begin
  -- The cash declaration is the top-up payment event; club_payments requires an order and is intentionally not used for non-order credit.
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'payments.record_cash') then raise exception 'Cash top-up is not permitted' using errcode='42501'; end if;
  if p_amount_minor <= 0 or p_currency !~ '^[A-Z]{3}$' or p_customer_id is null or p_location_id is null or coalesce(length(btrim(p_idempotency_key)),0)=0 then raise exception 'Invalid balance top-up' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
  if not found then raise exception 'Member not found' using errcode='P0002'; end if;
  if exists(select 1 from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then
    select to_jsonb(e) into v_existing from public.club_balance_entries e where e.organisation_id=p_organisation_id and e.idempotency_key=p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;
  select * into v_account from public.club_balance_accounts where organisation_id=p_organisation_id and customer_id=p_customer_id for update;
  if not found then insert into public.club_balance_accounts(organisation_id,customer_id,user_id,currency) values(p_organisation_id,p_customer_id,v_customer.user_id,p_currency) returning * into v_account; end if;
  if v_account.currency<>p_currency or v_account.status<>'active' then raise exception 'Balance account is unavailable' using errcode='22023'; end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,declared_amount_minor,currency,status,confirmed_at,confirmed_by,notes,idempotency_key)
    values(p_organisation_id,p_location_id,'balance_top_up',v_customer.user_id,p_customer_id,p_amount_minor,p_currency,'confirmed',now(),auth.uid(),p_notes,p_idempotency_key);
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,actor_user_id,reason,idempotency_key)
    values(v_account.id,p_organisation_id,'top_up',p_amount_minor,(select coalesce(sum(amount_delta_minor),0) from public.club_balance_entries where account_id=v_account.id)+p_amount_minor,auth.uid(),coalesce(p_notes,'Cash top-up'),p_idempotency_key) returning * into v_entry;
  return to_jsonb(v_entry);
end; $$;

create or replace function public.club_staff_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_account public.club_balance_accounts%rowtype; v_entry public.club_balance_entries%rowtype; v_existing public.club_balance_entries%rowtype; v_balance integer; v_item public.club_order_items%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update; if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(v_order.organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Balance sale is not permitted' using errcode='42501'; end if;
  if v_order.customer_id is null or v_order.status<>'pending_payment' or p_amount_minor<>v_order.total_minor or p_amount_minor<=0 or coalesce(length(btrim(p_idempotency_key)),0)=0 then raise exception 'Order is not eligible for balance payment' using errcode='22023'; end if;
  select * into v_account from public.club_balance_accounts where organisation_id=v_order.organisation_id and customer_id=v_order.customer_id for update; if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  select * into v_existing from public.club_balance_entries where organisation_id=v_order.organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(v_existing); end if;
  v_balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0); if v_balance<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(v_account.id,v_order.organisation_id,'purchase',-p_amount_minor,v_balance-p_amount_minor,v_order.id,auth.uid(),p_idempotency_key) returning * into v_entry;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(v_order.id,v_order.organisation_id,'balance',p_idempotency_key,p_amount_minor,v_order.currency,'paid');
  for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,auth.uid(),p_idempotency_key||':'||v_item.id) on conflict (organisation_id,idempotency_key) do nothing;
  end loop;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
  return to_jsonb(v_entry);
end; $$;

revoke all on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) from public,anon;
revoke all on function public.club_staff_spend_balance(uuid,integer,text) from public,anon;
grant execute on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) to authenticated;
grant execute on function public.club_staff_spend_balance(uuid,integer,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql ===
-- Additive parent/variant catalogue storage for deterministic supplier imports.
-- This migration is intentionally not applied by Codex.
alter table public.club_suppliers
  add column if not exists slug text,
  add column if not exists member_orderable boolean not null default false,
  add column if not exists catalogue_url text;

create unique index if not exists club_suppliers_org_slug_uq
  on public.club_suppliers(organisation_id, lower(slug)) where slug is not null;

create table if not exists public.club_supplier_parent_products (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade,
  parent_key text not null,
  brand text, name text not null, description text, category text, subcategory text,
  source_url text, parent_image_url text,
  active boolean not null default true, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id, supplier_id, parent_key)
);

alter table public.club_supplier_products
  add column if not exists parent_product_id uuid references public.club_supplier_parent_products(id) on delete set null,
  add column if not exists pack_quantity integer,
  add column if not exists member_orderable_unit text,
  add column if not exists availability_status text not null default 'unknown',
  add column if not exists availability_checked_at timestamptz,
  add column if not exists variant_image_url text,
  add column if not exists source_url text,
  add column if not exists active boolean not null default true,
  add column if not exists archived_at timestamptz;
alter table public.club_supplier_products drop constraint if exists club_supplier_products_availability_status_ck;
alter table public.club_supplier_products add constraint club_supplier_products_availability_status_ck check (availability_status in ('available','unavailable','unknown'));
create index if not exists club_supplier_products_parent_idx on public.club_supplier_products(parent_product_id);

create table if not exists public.club_supplier_variant_prices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_product_id uuid not null references public.club_supplier_products(id) on delete cascade,
  retail_price_minor integer not null check (retail_price_minor >= 0),
  currency text not null default 'GBP', active boolean not null default true,
  effective_from timestamptz not null default now(), effective_to timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id, supplier_product_id, effective_from)
);

alter table public.club_supplier_parent_products enable row level security;
alter table public.club_supplier_variant_prices enable row level security;
revoke all on public.club_supplier_parent_products, public.club_supplier_variant_prices from anon, authenticated;

create or replace function public.club_import_supplier_catalogue_v2(
  p_organisation_id uuid, p_supplier_name text, p_file_name text, p_rows jsonb, p_reconcile boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_supplier public.club_suppliers%rowtype; v_parent public.club_supplier_parent_products%rowtype; v_offer public.club_supplier_products%rowtype; v_row jsonb; v_parent_key text; v_created integer:=0; v_updated integer:=0; v_invalid integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier catalogue import is not permitted' using errcode='42501'; end if;
  if p_organisation_id is null or nullif(btrim(p_supplier_name),'') is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then raise exception 'Invalid supplier import' using errcode='22023'; end if;
  insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,btrim(p_supplier_name),lower(regexp_replace(btrim(p_supplier_name),'[^a-z0-9]+','-','g')),false)
    on conflict (organisation_id,lower(name)) do update set active=true,updated_at=now() returning * into v_supplier;
  insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count) values(p_organisation_id,v_supplier.id,coalesce(nullif(btrim(p_file_name),''),'supplier.csv'),auth.uid(),jsonb_array_length(p_rows));
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if nullif(btrim(v_row->>'name'),'') is null then v_invalid:=v_invalid+1; continue; end if;
    v_parent_key:=coalesce(nullif(btrim(v_row->>'parentKey'),''),lower(btrim(v_row->>'name')));
    insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url)
      values(p_organisation_id,v_supplier.id,v_parent_key,nullif(btrim(v_row->>'brand'),''),btrim(v_row->>'name'),nullif(v_row->>'description',''),nullif(btrim(v_row->>'category'),''),nullif(btrim(v_row->>'subcategory'),''),nullif(v_row->>'sourceUrl',''),nullif(v_row->>'parentImageUrl',''))
      on conflict (organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,updated_at=now() returning * into v_parent;
    select * into v_offer from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=v_supplier.id and ((nullif(btrim(v_row->>'supplierSku'),'') is not null and supplier_sku=btrim(v_row->>'supplierSku')) or (supplier_sku is null and parent_product_id=v_parent.id and coalesce(variant,'')=coalesce(nullif(btrim(v_row->>'flavour'),''),'') and coalesce(size,'')=coalesce(nullif(btrim(v_row->>'size'),''),''))) limit 1;
    if v_offer.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,supplier_sku,barcode,brand,name,variant,size,pack_quantity,member_orderable_unit,description,category,source_url,image_url,variant_image_url,availability_status,availability_checked_at,source_metadata)
      values(p_organisation_id,v_supplier.id,v_parent.id,nullif(btrim(v_row->>'supplierSku'),''),nullif(btrim(v_row->>'barcode'),''),nullif(btrim(v_row->>'brand'),''),v_parent.name,nullif(btrim(v_row->>'flavour'),''),nullif(btrim(v_row->>'size'),''),nullif(v_row->>'packQuantity','')::integer,nullif(btrim(v_row->>'memberOrderableUnit'),''),nullif(v_row->>'description',''),nullif(btrim(v_row->>'category'),''),nullif(v_row->>'sourceUrl',''),nullif(v_row->>'variantImageUrl',''),nullif(v_row->>'variantImageUrl',''),coalesce(nullif(v_row->>'availabilityStatus',''),'unknown'),nullif(v_row->>'availabilityCheckedAt','')::timestamptz,jsonb_build_object('parent_key',v_parent_key,'notes',v_row->>'notes')) returning * into v_offer; v_created:=v_created+1;
    else
      update public.club_supplier_products set parent_product_id=v_parent.id,barcode=nullif(btrim(v_row->>'barcode'),''),brand=nullif(btrim(v_row->>'brand'),''),name=v_parent.name,variant=nullif(btrim(v_row->>'flavour'),''),size=nullif(btrim(v_row->>'size'),''),pack_quantity=nullif(v_row->>'packQuantity','')::integer,member_orderable_unit=nullif(btrim(v_row->>'memberOrderableUnit'),''),description=nullif(v_row->>'description',''),category=nullif(btrim(v_row->>'category'),''),source_url=nullif(v_row->>'sourceUrl',''),variant_image_url=nullif(v_row->>'variantImageUrl',''),availability_status=coalesce(nullif(v_row->>'availabilityStatus',''),'unknown'),availability_checked_at=nullif(v_row->>'availabilityCheckedAt','')::timestamptz,updated_at=now() where id=v_offer.id; v_updated:=v_updated+1;
    end if;
  end loop;
  return jsonb_build_object('supplierId',v_supplier.id,'created',v_created,'updated',v_updated,'invalid',v_invalid,'reconciled',p_reconcile);
end; $$;
revoke all on function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) from public, anon;
grant execute on function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) to authenticated;

-- Member-safe read model: no supplier costs or operator-only metadata are returned.
create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',coalesce((select p.retail_price_minor from public.club_supplier_variant_prices p where p.organisation_id=sp.organisation_id and p.supplier_product_id=sp.id and p.active and (p.effective_to is null or p.effective_to>now()) order by p.effective_from desc limit 1),sp.retail_price_minor)) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active);
$$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon; grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;

create or replace function public.club_set_supplier_variant_retail_price(p_organisation_id uuid, p_supplier_product_id uuid, p_retail_price_minor integer, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Retail pricing is not permitted' using errcode='42501'; end if;
  if p_retail_price_minor is null or p_retail_price_minor < 0 then raise exception 'Invalid retail price' using errcode='22023'; end if;
  if not exists(select 1 from public.club_supplier_products where id=p_supplier_product_id and organisation_id=p_organisation_id) then raise exception 'Supplier variant not found' using errcode='P0002'; end if;
  insert into public.club_supplier_variant_prices(organisation_id,supplier_product_id,retail_price_minor,active,created_by) values(p_organisation_id,p_supplier_product_id,p_retail_price_minor,p_active,auth.uid());
  update public.club_supplier_products set retail_price_minor=p_retail_price_minor where id=p_supplier_product_id and organisation_id=p_organisation_id;
  select jsonb_build_object('supplierProductId',p_supplier_product_id,'retailPriceMinor',p_retail_price_minor,'active',p_active) into result; return result;
end; $$;
revoke all on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) from public,anon; grant execute on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) to authenticated;


-- === APPLY supabase/migrations/2026-10-13-glow-zone-transactional.sql ===
-- GLOW ZONE transactional credit lots and retained age verification.
-- Additive, migration-safe; do not apply automatically.
create table if not exists public.club_glow_age_verifications (
  organisation_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  date_of_birth date, status text not null default 'required' check (status in ('required','verified','under_18')),
  verified_at timestamptz, verified_by uuid references auth.users(id) on delete set null, verification_method text,
  primary key (organisation_id,user_id)
);
create table if not exists public.club_service_credit_lots (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, user_id uuid references auth.users(id) on delete set null,
  customer_id uuid, credit_key text not null, unit text not null, original_quantity integer not null check (original_quantity>0),
  remaining_quantity integer not null check (remaining_quantity>=0), granted_at timestamptz not null default now(), expires_at timestamptz,
  source_type text not null check (source_type in ('purchased','promotional','manual_adjustment','reversal_refund')),
  source_reference text, location_id uuid, actor_user_id uuid references auth.users(id) on delete set null, idempotency_key text,
  created_at timestamptz not null default now(), unique (organisation_id,idempotency_key)
);
create table if not exists public.club_service_credit_usage (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null, user_id uuid references auth.users(id) on delete set null,
  customer_id uuid, location_id uuid, minutes integer not null check (minutes>0), actor_user_id uuid references auth.users(id),
  idempotency_key text not null, allocations jsonb not null default '[]'::jsonb, qualifying_loyalty boolean not null default false,
  created_at timestamptz not null default now(), unique (organisation_id,idempotency_key)
);
create index if not exists club_service_credit_lots_balance_idx on public.club_service_credit_lots(organisation_id,credit_key,user_id,expires_at);
-- Bridge the existing canonical service-credit grant path into expiry lots. Legacy net balances
-- are represented once as non-expiring compatibility lots; new positive grants get a 3-month lot.
insert into public.club_service_credit_lots(organisation_id,user_id,customer_id,credit_key,unit,original_quantity,remaining_quantity,source_type,source_reference,actor_user_id,idempotency_key)
select a.organisation_id,a.user_id,a.customer_id,a.credit_key,a.unit,greatest(sum(e.quantity_delta),0),greatest(sum(e.quantity_delta),0),'manual_adjustment','legacy_service_credit_balance',null,'legacy:'||a.id::text
from public.club_service_credit_accounts a join public.club_service_credit_entries e on e.account_id=a.id
where a.credit_key='sunbed_minutes' group by a.id,a.organisation_id,a.user_id,a.customer_id,a.credit_key,a.unit having sum(e.quantity_delta)>0
on conflict (organisation_id,idempotency_key) do nothing;
create or replace function public.club_service_credit_lot_bridge() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.quantity_delta>0 and exists(select 1 from public.club_service_credit_accounts a where a.id=new.account_id and a.credit_key='sunbed_minutes') then
  insert into public.club_service_credit_lots(organisation_id,user_id,customer_id,credit_key,unit,original_quantity,remaining_quantity,granted_at,expires_at,source_type,source_reference,actor_user_id,idempotency_key)
  select a.organisation_id,a.user_id,a.customer_id,a.credit_key,a.unit,new.quantity_delta,new.quantity_delta,new.occurred_at,new.occurred_at+interval '3 months',case when new.entry_type='promotion_grant' then 'promotional' when new.entry_type='purchase_grant' then 'purchased' else 'manual_adjustment' end,new.id::text,new.actor_user_id,'entry:'||new.id::text from public.club_service_credit_accounts a where a.id=new.account_id on conflict (organisation_id,idempotency_key) do nothing;
 end if; return new;
end; $$;
drop trigger if exists club_service_credit_lot_bridge on public.club_service_credit_entries;
create trigger club_service_credit_lot_bridge after insert on public.club_service_credit_entries for each row execute function public.club_service_credit_lot_bridge();
alter table public.club_glow_age_verifications enable row level security; alter table public.club_service_credit_lots enable row level security; alter table public.club_service_credit_usage enable row level security;
drop policy if exists glow_age_self_staff on public.club_glow_age_verifications; create policy glow_age_self_staff on public.club_glow_age_verifications for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
drop policy if exists glow_lots_self_staff on public.club_service_credit_lots; create policy glow_lots_self_staff on public.club_service_credit_lots for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
drop policy if exists glow_usage_self_staff on public.club_service_credit_usage; create policy glow_usage_self_staff on public.club_service_credit_usage for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create or replace function public.club_glow_record_age_verification(p_organisation_id uuid,p_user_id uuid,p_date_of_birth date,p_method text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare r public.club_glow_age_verifications%rowtype; begin if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Age verification is not permitted' using errcode='42501'; end if; insert into public.club_glow_age_verifications(organisation_id,user_id,date_of_birth,status,verified_at,verified_by,verification_method) values(p_organisation_id,p_user_id,p_date_of_birth,case when p_date_of_birth <= (current_date - interval '18 years')::date then 'verified' else 'under_18' end,case when p_date_of_birth <= (current_date - interval '18 years')::date then now() end,case when p_date_of_birth <= (current_date - interval '18 years')::date then auth.uid() end,p_method) on conflict (organisation_id,user_id) do update set date_of_birth=excluded.date_of_birth,status=excluded.status,verified_at=excluded.verified_at,verified_by=excluded.verified_by,verification_method=excluded.verification_method returning * into r; return to_jsonb(r); end; $$;
revoke all on function public.club_glow_record_age_verification(uuid,uuid,date,text) from public,anon,authenticated; grant execute on function public.club_glow_record_age_verification(uuid,uuid,date,text) to authenticated;

create or replace function public.club_glow_balance(p_organisation_id uuid,p_user_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select case when auth.uid()=p_user_id or public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then jsonb_build_object('minutes',coalesce(sum(remaining_quantity) filter(where expires_at is null or expires_at>now()),0),'next_expiry',min(expires_at) filter(where remaining_quantity>0 and expires_at>now())) else jsonb_build_object('minutes',0,'next_expiry',null) end from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes'; $$;
create or replace function public.club_glow_spend(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb; u public.club_service_credit_usage%rowtype; l record; take integer; left_qty integer:=p_minutes; alloc jsonb:='[]'::jsonb; adult boolean;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or p_minutes<=0 then raise exception 'Glow Zone usage is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 if exists(select 1 from public.club_service_credit_usage where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then select to_jsonb(u) into v from public.club_service_credit_usage u where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; return v; end if;
 select status='verified' and date_of_birth <= (current_date - interval '18 years')::date into adult from public.club_glow_age_verifications where organisation_id=p_organisation_id and user_id=p_user_id; if not coalesce(adult,false) then raise exception 'Glow Zone age verification required' using errcode='42501'; end if;
 for l in select * from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes' and remaining_quantity>0 and (expires_at is null or expires_at>now()) order by expires_at nulls last,granted_at,id for update loop exit when left_qty=0; take:=least(left_qty,l.remaining_quantity); update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take where id=l.id; alloc:=alloc||jsonb_build_array(jsonb_build_object('lot_id',l.id,'quantity',take)); left_qty:=left_qty-take; end loop;
 if left_qty>0 then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
 insert into public.club_service_credit_usage(organisation_id,user_id,location_id,minutes,actor_user_id,idempotency_key,allocations,qualifying_loyalty) values(p_organisation_id,p_user_id,p_location_id,p_minutes,auth.uid(),p_idempotency_key,alloc,p_minutes>=5) returning * into u; return to_jsonb(u);
end; $$;
revoke all on function public.club_glow_balance(uuid,uuid),public.club_glow_spend(uuid,uuid,uuid,integer,text) from public,anon,authenticated; grant execute on function public.club_glow_balance(uuid,uuid) to authenticated; grant execute on function public.club_glow_spend(uuid,uuid,uuid,integer,text) to authenticated;

create or replace function public.club_glow_grant_manual(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_lot public.club_service_credit_lots%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) or p_minutes<=0 or nullif(trim(p_reason),'') is null then raise exception 'Glow Zone adjustment is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 if exists(select 1 from public.club_service_credit_lots where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key) then select * into v_lot from public.club_service_credit_lots where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; return to_jsonb(v_lot); end if;
 insert into public.club_service_credit_lots(organisation_id,user_id,credit_key,unit,original_quantity,remaining_quantity,expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key)
 values(p_organisation_id,p_user_id,'sunbed_minutes','minute',p_minutes,p_minutes,now()+interval '3 months','manual_adjustment',p_reason,p_location_id,auth.uid(),p_idempotency_key) returning * into v_lot;
 return to_jsonb(v_lot);
end; $$;
revoke all on function public.club_glow_grant_manual(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated; grant execute on function public.club_glow_grant_manual(uuid,uuid,uuid,integer,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-09-15-shared-shop-supplier-catalogue.sql ===
-- Shared durable supplier catalogue read for member and reception shops.
create or replace function public.club_list_shop_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'localStockTracked',coalesce((select cp.stock_tracked from public.club_commerce_products cp where cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id),false),'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',sp.retail_price_minor) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active and s.member_orderable
  and exists(select 1 from public.club_supplier_products available where available.organisation_id=pp.organisation_id and available.parent_product_id=pp.id and available.active and available.sellable and not available.discontinued and available.availability_status='available')
  and (exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active)
    or public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.collections_manage'));
$$;
revoke all on function public.club_list_shop_supplier_catalogue(uuid,uuid) from public,anon;
grant execute on function public.club_list_shop_supplier_catalogue(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-15-stock-reservation-totals-rpc.sql ===
create or replace function public.club_list_stock_reservation_totals(p_organisation_id uuid, p_location_id uuid default null)
returns table(organisation_id uuid, location_id uuid, product_id uuid, reserved_quantity integer)
language sql security definer set search_path=pg_catalog,public as $$
  select r.organisation_id, r.location_id, r.product_id, sum(r.quantity)::integer
  from public.club_stock_reservations r
  where auth.uid() is not null
    and public.club_has_active_role(p_organisation_id, array['member','trainer','gym_staff','gym_admin','owner','guest'])
    and r.organisation_id = p_organisation_id
    and (p_location_id is null or r.location_id = p_location_id)
    and r.status = 'active'
  group by r.organisation_id, r.location_id, r.product_id
$$;
revoke all on function public.club_list_stock_reservation_totals(uuid,uuid) from public, anon;
grant execute on function public.club_list_stock_reservation_totals(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-16-active-sports-commerce-media.sql ===
-- Keep Active Sports imagery on the same persisted commerce media path as GSN.
-- Existing valid commerce media always wins; supplier variant then parent image
-- fills only an empty/invalid media value.
create or replace function public.club_sync_supplier_commerce_media()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_parent_image text;
  v_url text;
begin
  if new.club_product_id is null then return new; end if;
  select pp.parent_image_url into v_parent_image
  from public.club_supplier_parent_products pp
  where pp.id = new.parent_product_id and pp.organisation_id = new.organisation_id;
  v_url := case
    when new.variant_image_url ~* '^https?://' then new.variant_image_url
    when v_parent_image ~* '^https?://' then v_parent_image
    else null
  end;
  if v_url is not null then
    update public.club_commerce_products cp
    set media = case when coalesce(cp.media->>'url','') ~* '^https?://' then cp.media else jsonb_build_object('url', v_url) end,
        updated_at = now()
    where cp.id = new.club_product_id and cp.organisation_id = new.organisation_id;
  end if;
  return new;
end;
$$;

create or replace function public.club_sync_parent_commerce_media()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.parent_image_url is not null and new.parent_image_url ~* '^https?://' then
    update public.club_commerce_products cp
    set media = case when coalesce(cp.media->>'url','') ~* '^https?://' then cp.media else jsonb_build_object('url', new.parent_image_url) end,
        updated_at = now()
    from public.club_supplier_products sp
    where sp.parent_product_id = new.id and sp.organisation_id = new.organisation_id
      and sp.club_product_id = cp.id and cp.organisation_id = new.organisation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists club_sync_supplier_commerce_media on public.club_supplier_products;
create trigger club_sync_supplier_commerce_media
after insert or update of club_product_id, variant_image_url, parent_product_id
on public.club_supplier_products
for each row execute function public.club_sync_supplier_commerce_media();

drop trigger if exists club_sync_parent_commerce_media on public.club_supplier_parent_products;
create trigger club_sync_parent_commerce_media
after update of parent_image_url on public.club_supplier_parent_products
for each row execute function public.club_sync_parent_commerce_media();

-- Backfill existing linked products without replacing a valid local/manual URL.
update public.club_commerce_products cp
set media = jsonb_build_object('url', coalesce(nullif(sp.variant_image_url, ''), nullif(pp.parent_image_url, ''))),
    updated_at = now()
from public.club_supplier_products sp
join public.club_supplier_parent_products pp on pp.id = sp.parent_product_id and pp.organisation_id = sp.organisation_id
join public.club_suppliers s on s.id = sp.supplier_id and s.organisation_id = sp.organisation_id
where s.name = 'Active Sports'
  and sp.organisation_id = cp.organisation_id
  and sp.club_product_id = cp.id
  and coalesce(cp.media->>'url','') !~* '^https?://'
  and coalesce(nullif(sp.variant_image_url, ''), nullif(pp.parent_image_url, '')) ~* '^https?://';

revoke all on function public.club_sync_supplier_commerce_media() from public, anon, authenticated;
revoke all on function public.club_sync_parent_commerce_media() from public, anon, authenticated;


-- === APPLY supabase/migrations/2026-09-17-active-sports-authoritative-image-sync.sql ===
-- Active Sports supplier imagery is catalogue-owned.  A valid image supplied
-- by the current import replaces stale supplier media; blank input is ignored.
create or replace function public.club_sync_supplier_commerce_media()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_parent_image text; v_url text;
begin
  if new.club_product_id is null then return new; end if;
  select pp.parent_image_url into v_parent_image
  from public.club_supplier_parent_products pp
  where pp.id=new.parent_product_id and pp.organisation_id=new.organisation_id;
  v_url:=case when new.variant_image_url ~* '^https?://' then btrim(new.variant_image_url)
              when v_parent_image ~* '^https?://' then btrim(v_parent_image) end;
  if v_url is not null then
    update public.club_commerce_products cp
    set media=jsonb_build_object('url',v_url), updated_at=now()
    where cp.id=new.club_product_id and cp.organisation_id=new.organisation_id;
  end if;
  return new;
end; $$;

create or replace function public.club_sync_parent_commerce_media()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.parent_image_url ~* '^https?://' then
    update public.club_commerce_products cp
    set media=jsonb_build_object('url',btrim(new.parent_image_url)), updated_at=now()
    from public.club_supplier_products sp
    where sp.parent_product_id=new.id and sp.organisation_id=new.organisation_id
      and sp.club_product_id=cp.id and cp.organisation_id=new.organisation_id;
  end if;
  return new;
end; $$;

-- Refresh existing linked rows immediately when this migration is applied.
update public.club_commerce_products cp
set media=jsonb_build_object('url',btrim(coalesce(nullif(sp.variant_image_url,''),nullif(pp.parent_image_url,'')))), updated_at=now()
from public.club_supplier_products sp
join public.club_supplier_parent_products pp on pp.id=sp.parent_product_id and pp.organisation_id=sp.organisation_id
join public.club_suppliers s on s.id=sp.supplier_id and s.organisation_id=sp.organisation_id
where s.name='Active Sports' and sp.organisation_id=cp.organisation_id and sp.club_product_id=cp.id
  and coalesce(nullif(sp.variant_image_url,''),nullif(pp.parent_image_url,'')) ~* '^https?://';

revoke all on function public.club_sync_supplier_commerce_media() from public,anon,authenticated;
revoke all on function public.club_sync_parent_commerce_media() from public,anon,authenticated;


-- === APPLY supabase/migrations/2026-09-17-fix-member-supplier-catalogue-staff-auth.sql ===
-- Permit the existing durable member catalogue read for operational staff too.
-- The query and return contract intentionally remain identical to the canonical RPC.
create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'localStockTracked',coalesce((select cp.stock_tracked from public.club_commerce_products cp where cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id),false),'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',sp.retail_price_minor) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active and s.member_orderable
  and exists(select 1 from public.club_supplier_products available where available.organisation_id=pp.organisation_id and available.parent_product_id=pp.id and available.active and available.sellable and not available.discontinued and available.availability_status='available')
  and auth.uid() is not null
  and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('member','gym_staff','gym_admin','owner'));
$$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon;
grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-17-fix-shared-shop-staff-authorization.sql ===
-- Shared durable supplier catalogue read for member and reception shops.
create or replace function public.club_list_shop_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'localStockTracked',coalesce((select cp.stock_tracked from public.club_commerce_products cp where cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id),false),'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',sp.retail_price_minor) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active and s.member_orderable
  and exists(select 1 from public.club_supplier_products available where available.organisation_id=pp.organisation_id and available.parent_product_id=pp.id and available.active and available.sellable and not available.discontinued and available.availability_status='available')
  and auth.uid() is not null
  and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('member','gym_staff','gym_admin','owner'));
$$;
revoke all on function public.club_list_shop_supplier_catalogue(uuid,uuid) from public,anon;
grant execute on function public.club_list_shop_supplier_catalogue(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-17-glow-age-status-read.sql ===
-- Allow authorised Club staff to read a member's retained Glow Zone age status.
-- Read-only security-definer boundary avoids relying on client table RLS for the operational screen.
create or replace function public.club_glow_age_status(p_organisation_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.club_glow_age_verifications%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id, array['gym_staff','gym_admin','owner']) then
    raise exception 'Glow Zone age status is not permitted' using errcode = '42501';
  end if;
  select * into v_row
  from public.club_glow_age_verifications
  where organisation_id = p_organisation_id and user_id = p_user_id;
  return case when v_row.user_id is null then null else jsonb_build_object('date_of_birth', v_row.date_of_birth, 'status', v_row.status) end;
end;
$$;
revoke all on function public.club_glow_age_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.club_glow_age_status(uuid, uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-18-club-delivery-pricing.sql ===
-- Delivery receipts and commercial history. Review-only; never execute from the app.
create table if not exists public.club_inventory_receipts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, supplier_name text, supplier_reference text, received_at timestamptz not null default now(), received_by uuid not null references auth.users(id), notes text, idempotency_key text, created_at timestamptz not null default now(),
  unique (id, organisation_id), foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id)
);
alter table public.club_inventory_receipts add column if not exists idempotency_key text;
create unique index if not exists club_inventory_receipts_org_idempotency_uidx on public.club_inventory_receipts(organisation_id, idempotency_key) where idempotency_key is not null;
create table if not exists public.club_inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(), receipt_id uuid not null, organisation_id uuid not null, product_id uuid not null, quantity_received integer not null check (quantity_received > 0), unit_cost_minor integer check (unit_cost_minor is null or unit_cost_minor >= 0), vat_rate_percent numeric check (vat_rate_percent is null or vat_rate_percent >= 0), notes text, created_at timestamptz not null default now(), unique (id, organisation_id), foreign key (receipt_id, organisation_id) references public.club_inventory_receipts(id, organisation_id) on delete cascade, foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
create table if not exists public.club_product_cost_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, product_id uuid not null, unit_cost_minor integer not null check (unit_cost_minor >= 0), effective_at timestamptz not null default now(), source_type text not null check (source_type in ('delivery','invoice','manual')), source_id uuid, supplier_name text, supplier_reference text, recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(), foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
create table if not exists public.club_product_price_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, product_id uuid not null, old_price_minor integer not null check (old_price_minor >= 0), new_price_minor integer not null check (new_price_minor >= 0), changed_by uuid not null references auth.users(id), changed_at timestamptz not null default now(), reason text, foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
create index if not exists club_inventory_receipts_org_date_idx on public.club_inventory_receipts(organisation_id, received_at desc);
create index if not exists club_inventory_receipt_lines_receipt_idx on public.club_inventory_receipt_lines(receipt_id);
create index if not exists club_product_cost_history_product_idx on public.club_product_cost_history(organisation_id, product_id, effective_at desc);
alter table public.club_inventory_receipts enable row level security; alter table public.club_inventory_receipt_lines enable row level security; alter table public.club_product_cost_history enable row level security; alter table public.club_product_price_history enable row level security;
revoke all on table public.club_inventory_receipts, public.club_inventory_receipt_lines, public.club_product_cost_history, public.club_product_price_history from public, anon, authenticated;

create or replace function public.club_receive_inventory_delivery(p_organisation_id uuid, p_location_id uuid, p_supplier_name text, p_supplier_reference text, p_received_at timestamptz, p_notes text, p_lines jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_receipt public.club_inventory_receipts%rowtype; v_line jsonb; v_product public.club_commerce_products%rowtype; v_qty integer; v_cost integer; v_vat numeric; v_key text; v_idempotency text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'inventory.adjust') then raise exception 'Inventory permission required' using errcode='42501'; end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Location does not belong to organisation' using errcode='22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one delivery line is required' using errcode='22023'; end if;
  v_idempotency := nullif(btrim(p_idempotency_key),'');
  if v_idempotency is not null then select * into v_receipt from public.club_inventory_receipts where organisation_id=p_organisation_id and idempotency_key=v_idempotency limit 1; if found then return to_jsonb(v_receipt); end if; end if;
  begin
    insert into public.club_inventory_receipts(organisation_id,location_id,supplier_name,supplier_reference,received_at,received_by,notes,idempotency_key) values(p_organisation_id,p_location_id,nullif(btrim(p_supplier_name),''),nullif(btrim(p_supplier_reference),''),coalesce(p_received_at,now()),auth.uid(),p_notes,v_idempotency) returning * into v_receipt;
  exception when unique_violation then
    if v_idempotency is not null then select * into v_receipt from public.club_inventory_receipts where organisation_id=p_organisation_id and idempotency_key=v_idempotency limit 1; if found then return to_jsonb(v_receipt); end if; end if;
    raise;
  end;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_key := nullif(v_line->>'product_id','');
    if v_key is null or v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Delivery product is invalid' using errcode='22023'; end if;
    if coalesce(v_line->>'quantity','') !~ '^[0-9]+$' then raise exception 'Delivery quantity must be a positive integer' using errcode='22023'; end if;
    v_qty := (v_line->>'quantity')::integer;
    if v_qty <= 0 then raise exception 'Delivery quantity must be a positive integer' using errcode='22023'; end if;
    if v_line ? 'unit_cost_minor' and v_line->>'unit_cost_minor' is not null and v_line->>'unit_cost_minor' <> '' then
      if (v_line->>'unit_cost_minor') !~ '^[0-9]+$' then raise exception 'Unit cost must be a nonnegative integer' using errcode='22023'; end if;
      v_cost := (v_line->>'unit_cost_minor')::integer;
    else v_cost := null;
    end if;
    if v_line ? 'vat_rate_percent' and v_line->>'vat_rate_percent' is not null and v_line->>'vat_rate_percent' <> '' then
      begin v_vat := (v_line->>'vat_rate_percent')::numeric; exception when others then raise exception 'VAT rate is invalid' using errcode='22023'; end;
      if v_vat < 0 or v_vat >= 100 then raise exception 'VAT rate is invalid' using errcode='22023'; end if;
    else v_vat := null;
    end if;
    select * into v_product from public.club_commerce_products where id=v_key::uuid and organisation_id=p_organisation_id and active for update;
    if not found or not v_product.stock_tracked then raise exception 'Delivery product is invalid' using errcode='22023'; end if;
    insert into public.club_inventory_receipt_lines(receipt_id,organisation_id,product_id,quantity_received,unit_cost_minor,vat_rate_percent,notes) values(v_receipt.id,p_organisation_id,v_product.id,v_qty,v_cost,v_vat,v_line->>'notes');
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,actor_user_id,reason) values(p_organisation_id,p_location_id,v_product.id,'delivery',v_qty,auth.uid(),concat('Delivery receipt ',v_receipt.id));
    if v_cost is not null then insert into public.club_product_cost_history(organisation_id,product_id,unit_cost_minor,source_type,source_id,supplier_name,supplier_reference,recorded_by) values(p_organisation_id,v_product.id,v_cost,'delivery',v_receipt.id,v_receipt.supplier_name,v_receipt.supplier_reference,auth.uid()); update public.club_commerce_products set cost_price_minor=v_cost,updated_at=now() where id=v_product.id and organisation_id=p_organisation_id; end if;
  end loop;
  perform public.club_append_audit_event(p_organisation_id,'inventory.delivery_received','inventory_receipt',v_receipt.id,p_location_id,null,jsonb_build_object('supplier',v_receipt.supplier_name,'reference',v_receipt.supplier_reference));
  return to_jsonb(v_receipt);
end; $$;
revoke all on function public.club_receive_inventory_delivery(uuid,uuid,text,text,timestamptz,text,jsonb,text) from public,anon;
grant execute on function public.club_receive_inventory_delivery(uuid,uuid,text,text,timestamptz,text,jsonb,text) to authenticated;

create or replace function public.club_list_inventory_receipts(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.received_at desc), '[]'::jsonb)
  from public.club_inventory_receipts r
  where r.organisation_id = p_organisation_id and (p_location_id is null or r.location_id = p_location_id)
    and exists (select 1 from public.club_members m where m.organisation_id = r.organisation_id and m.user_id = auth.uid() and m.active and m.role in ('gym_staff','gym_admin','owner'));
$$;
revoke all on function public.club_list_inventory_receipts(uuid,uuid) from public,anon;
grant execute on function public.club_list_inventory_receipts(uuid,uuid) to authenticated;

create or replace function public.club_record_commerce_price_history()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is not null and old.sell_price_minor is distinct from new.sell_price_minor then
    insert into public.club_product_price_history(organisation_id, product_id, old_price_minor, new_price_minor, changed_by, reason)
    values(new.organisation_id, new.id, old.sell_price_minor, new.sell_price_minor, auth.uid(), 'manual');
  end if;
  return new;
end; $$;
drop trigger if exists club_commerce_product_price_history on public.club_commerce_products;
create trigger club_commerce_product_price_history after update of sell_price_minor on public.club_commerce_products
for each row execute function public.club_record_commerce_price_history();


-- === APPLY supabase/migrations/2026-09-18-restore-member-supplier-catalogue-query.sql ===
-- Restore the canonical durable catalogue query; only staff authorisation differs.
create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',coalesce((select p.retail_price_minor from public.club_supplier_variant_prices p where p.organisation_id=sp.organisation_id and p.supplier_product_id=sp.id and p.active and (p.effective_to is null or p.effective_to>now()) order by p.effective_from desc limit 1),sp.retail_price_minor)) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active
  and auth.uid() is not null
  and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('member','gym_staff','gym_admin','owner'));
$$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon;
grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-19-club-member-account-identity.sql ===
-- Resolve linked R12 account identity for authorised Club staff.
-- This reads the existing public profile projection and does
-- not grant browser table access. Review and execute in the target environment.

create or replace function public.club_resolve_member_identity(p_organisation_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Member identity is not permitted' using errcode='42501';
  end if;
  if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    raise exception 'Club member not found' using errcode='P0002';
  end if;
  return coalesce((select jsonb_build_object('user_id',p_user_id,'display_name',nullif(btrim(p.display_name),''),'email',nullif(btrim(p.email),'')) from public.profiles p where p.id=p_user_id),'{}'::jsonb);
end; $$;

create or replace function public.club_list_member_identities(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then
    raise exception 'Member identity directory is not permitted' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',nullif(btrim(p.display_name),''),'email',nullif(btrim(p.email),'')) order by m.created_at) from public.club_members m left join public.profiles p on p.id=m.user_id where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;

create or replace function public.club_list_member_summaries(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Member directory is not permitted' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,'active',m.active,'display_name',coalesce(nullif(c.display_name,''),nullif(p.display_name,''),nullif(p.email,''),'Club member'),'email',coalesce(nullif(c.email,''),nullif(p.email,'')),'membership_name',current_membership.product_name,'membership_status',current_membership.status,'membership_ends_at',current_membership.ends_at,'home_location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,'access_state',(public.club_evaluate_member_access(p_organisation_id,m.user_id)->>'state')) order by coalesce(nullif(c.display_name,''),nullif(p.display_name,''),nullif(p.email,''),'Club member'),m.created_at) from public.club_members m left join public.club_customers c on c.organisation_id=m.organisation_id and c.user_id=m.user_id left join public.profiles p on p.id=m.user_id left join public.club_locations l on l.id=m.preferred_location_id and l.organisation_id=m.organisation_id left join lateral (select ms.id,p2.name product_name,ms.status,ms.ends_at from public.club_memberships ms join public.club_products p2 on p2.id=ms.product_id and p2.organisation_id=ms.organisation_id where ms.organisation_id=p_organisation_id and exists(select 1 from public.club_membership_holders h where h.membership_id=ms.id and h.user_id=m.user_id) order by (ms.status='active') desc,ms.starts_at desc limit 1) current_membership on true where m.organisation_id=p_organisation_id and m.active),'[]'::jsonb);
end; $$;

revoke all on function public.club_resolve_member_identity(uuid,uuid),public.club_list_member_identities(uuid) from public;
grant execute on function public.club_resolve_member_identity(uuid,uuid),public.club_list_member_identities(uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-19-restore-supplier-availability-projection.sql ===
-- Restore the member-safe supplier catalogue read model after the later
-- pricing migration reintroduced sellable/available filters. Availability is
-- projected per variant and resolved by the shop; catalogue discovery must
-- not require a local row or the supplier's sellable flag.
create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',coalesce((select p.retail_price_minor from public.club_supplier_variant_prices p where p.organisation_id=sp.organisation_id and p.supplier_product_id=sp.id and p.active and (p.effective_to is null or p.effective_to>now()) order by p.effective_from desc limit 1),sp.retail_price_minor)) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active
  and auth.uid() is not null
  and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role in ('member','gym_staff','gym_admin','owner'));
$$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon;
grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-20-club-commerce-product-brand.sql ===
-- Optional retail brand, kept separate from the product name.
-- Review and execute in the target environment; never run from the app.
alter table public.club_commerce_products add column if not exists brand text;
alter table public.club_commerce_products add constraint club_commerce_products_brand_length check (brand is null or length(btrim(brand)) between 1 and 120);

drop function if exists public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb);
create or replace function public.club_save_commerce_product(p_id uuid,p_organisation_id uuid,p_sku text,p_barcode text,p_name text,p_brand text,p_description text,p_category text,p_active boolean,p_stock_tracked boolean,p_sell_price_minor integer,p_cost_price_minor integer,p_currency text,p_tax_code text,p_supplier_reference text,p_media jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_commerce_products%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Commerce catalogue administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or p_brand is not null and length(btrim(p_brand))>120 or p_sell_price_minor<0 or (p_cost_price_minor is not null and p_cost_price_minor<0) or p_currency !~ '^[A-Z]{3}$' or p_media is not null and jsonb_typeof(p_media)<>'object' then raise exception 'Invalid commerce product input' using errcode='22023'; end if;
  if p_id is null then
    insert into public.club_commerce_products(organisation_id,sku,barcode,name,brand,description,category,active,stock_tracked,sell_price_minor,cost_price_minor,currency,tax_code,supplier_reference,media)
    values(p_organisation_id,nullif(btrim(p_sku),''),nullif(btrim(p_barcode),''),btrim(p_name),nullif(btrim(p_brand),''),p_description,nullif(btrim(p_category),''),p_active,p_stock_tracked,p_sell_price_minor,p_cost_price_minor,p_currency,p_tax_code,p_supplier_reference,p_media) returning * into v_row;
  else
    update public.club_commerce_products set sku=nullif(btrim(p_sku),''),barcode=nullif(btrim(p_barcode),''),name=btrim(p_name),brand=nullif(btrim(p_brand),''),description=p_description,category=nullif(btrim(p_category),''),active=p_active,stock_tracked=p_stock_tracked,sell_price_minor=p_sell_price_minor,cost_price_minor=p_cost_price_minor,currency=p_currency,tax_code=p_tax_code,supplier_reference=p_supplier_reference,media=p_media,updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row;
    if not found then raise exception 'Commerce product not found' using errcode='P0002'; end if;
  end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb) from public,anon;
grant execute on function public.club_save_commerce_product(uuid,uuid,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,text,jsonb) to authenticated;


-- === APPLY supabase/migrations/2026-09-20-enable-active-sports-member-ordering.sql ===
-- Active Sports is a member-orderable catalogue source for Madhouse. Keep
-- this invariant on future importer upserts, which historically created the
-- supplier with member_orderable=false and did not update that column.
update public.club_suppliers
set member_orderable=true, updated_at=now()
where organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
  and lower(btrim(name))='active sports';

create or replace function public.club_keep_madhouse_active_sports_orderable()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid
     and lower(btrim(new.name))='active sports' then
    new.member_orderable=true;
  end if;
  return new;
end; $$;

drop trigger if exists club_keep_madhouse_active_sports_orderable on public.club_suppliers;
create trigger club_keep_madhouse_active_sports_orderable
before insert or update of name,organisation_id,member_orderable
on public.club_suppliers
for each row execute function public.club_keep_madhouse_active_sports_orderable();


-- === APPLY supabase/migrations/2026-09-21-club-cash-settlement-safety.sql ===
-- Defer member cash-declaration stock effects until staff confirmation.
-- Review and execute in the target environment; do not run from the application.
create or replace function public.club_declare_cash_payment(p_organisation_id uuid,p_location_id uuid,p_purpose text,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_membership_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype;
begin
  if auth.uid() is null or p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_purpose not in ('commerce_order','membership','balance_top_up','other') or p_user_id is distinct from auth.uid() then raise exception 'Invalid cash declaration' using errcode='42501'; end if;
  if not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Organisation access is not permitted' using errcode='42501'; end if;
  if p_purpose='commerce_order' then
    if p_order_id is null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
    select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and user_id=auth.uid() for update;
    if not found or v_order.status<>'pending_payment' or v_order.total_minor<>p_amount_minor or v_order.currency<>p_currency or p_location_id is distinct from v_order.location_id then raise exception 'Order is not eligible for cash declaration' using errcode='22023'; end if;
  elsif p_purpose='membership' then
    if p_membership_id is null or p_order_id is not null or not exists(select 1 from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id and m.organisation_id=p_organisation_id where h.membership_id=p_membership_id and h.user_id=auth.uid()) then raise exception 'Membership is not associated with caller' using errcode='42501'; end if;
  elsif p_purpose='balance_top_up' then
    if p_order_id is not null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
  elsif p_order_id is not null or p_membership_id is not null then raise exception 'Cash declaration resource is invalid' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and user_id=auth.uid()) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if p_idempotency_key is not null then select * into v_row from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then if v_row.user_id is distinct from auth.uid() or v_row.order_id is distinct from p_order_id or v_row.declared_amount_minor<>p_amount_minor then raise exception 'Idempotency key conflict' using errcode='23505'; end if; return to_jsonb(v_row); end if; end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,order_id,membership_id,declared_amount_minor,currency,idempotency_key) values(p_organisation_id,p_location_id,p_purpose,auth.uid(),p_customer_id,p_order_id,p_membership_id,p_amount_minor,p_currency,p_idempotency_key) returning * into v_row;
  if p_order_id is not null then update public.club_orders set status='awaiting_cash_verification',updated_at=now() where id=p_order_id; end if;
  return to_jsonb(v_row);
end; $$;

create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype; v_payment public.club_payments%rowtype; v_item public.club_order_items%rowtype;
begin
  select * into v_row from public.club_cash_declarations where id=p_declaration_id for update; if not found or not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if v_row.status<> 'declared' then if v_row.status=p_status then return to_jsonb(v_row); else raise exception 'Cash declaration decision conflicts' using errcode='23505'; end if; end if;
  if p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  if v_row.purpose='commerce_order' then
    select * into v_order from public.club_orders where id=v_row.order_id for update;
    if p_status='confirmed' then
      if v_order.status<>'awaiting_cash_verification' then raise exception 'Order is not awaiting cash confirmation' using errcode='22023'; end if;
      insert into public.club_payments(order_id,organisation_id,method,amount_minor,currency,status,external_reference) values(v_order.id,v_order.organisation_id,'cash',v_order.total_minor,v_order.currency,'paid',coalesce(v_row.idempotency_key,v_row.id::text)) returning * into v_payment;
      for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
        insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,auth.uid(),'cash-confirmed:'||v_row.id::text||':'||v_item.id::text) on conflict (organisation_id,idempotency_key) do nothing;
      end loop;
      update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
    elsif v_order.status='awaiting_cash_verification' then update public.club_orders set status='cash_disputed',updated_at=now() where id=v_order.id; end if;
  end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=v_row.id returning * into v_row; return to_jsonb(v_row);
end; $$;


-- === APPLY supabase/migrations/2026-09-21-club-staff-admin-grant-boundary.sql ===
-- Only owners may prepare a pending grant that will create another gym_admin.
-- Existing gym_admin authority to grant gym_staff and trainer access is unchanged.
create or replace function public.club_create_staff_access_grant(p_organisation_id uuid,p_email text,p_display_name text,p_role text,p_location_ids uuid[],p_capabilities text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; e text;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Staff access requires admin permission' using errcode='42501'; end if;
 if p_role not in ('gym_staff','gym_admin','trainer') or nullif(btrim(p_email),'') is null then raise exception 'Invalid staff access request' using errcode='22023'; end if;
 if p_role='gym_admin' and not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Only an owner may grant admin access' using errcode='42501'; end if;
 if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(select 1 from public.club_locations l where l.id=x and l.organisation_id=p_organisation_id and l.active)) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
 foreach e in array coalesce(p_capabilities,'{}') loop if e not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then raise exception 'Invalid capability' using errcode='22023'; end if; end loop;
 update public.club_staff_access_grants set status='expired' where organisation_id=p_organisation_id and email_normalized=lower(btrim(p_email)) and status='pending' and expires_at<=now();
 insert into public.club_staff_access_grants(organisation_id,email_normalized,display_name,intended_role,location_ids,capabilities,created_by) values(p_organisation_id,lower(btrim(p_email)),nullif(btrim(p_display_name),''),p_role,coalesce(p_location_ids,'{}'),coalesce(p_capabilities,'{}'),auth.uid()) returning * into g;
 return to_jsonb(g);
end; $$;
revoke all on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) from public,anon; grant execute on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) to authenticated;


-- === APPLY supabase/migrations/2026-09-26-club-supplier-cycles.sql ===
-- Supplier-specific ordering cycles and location replenishment.
-- Run after 2026-09-22-club-supplier-commerce.sql.

alter table public.club_suppliers
  add column if not exists timezone text not null default 'Europe/London',
  add column if not exists ordering_active boolean not null default true,
  add column if not exists cutoff_weekday smallint,
  add column if not exists cutoff_local_time time,
  add column if not exists order_weekday smallint,
  add column if not exists delivery_start_weekday smallint,
  add column if not exists delivery_end_weekday smallint;
do $$ begin
  alter table public.club_suppliers drop constraint if exists club_suppliers_weekdays_ck;
  alter table public.club_suppliers add constraint club_suppliers_weekdays_ck check (
    (cutoff_weekday is null or cutoff_weekday between 0 and 6) and
    (order_weekday is null or order_weekday between 0 and 6) and
    (delivery_start_weekday is null or delivery_start_weekday between 0 and 6) and
    (delivery_end_weekday is null or delivery_end_weekday between 0 and 6));
end $$;

create table if not exists public.club_supplier_order_cycles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete restrict,
  cycle_key text not null,
  cutoff_at timestamptz,
  order_date date,
  delivery_start_date date,
  delivery_end_date date,
  status text not null default 'open' check (status in ('open','prepared','ordered','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id, supplier_id, cycle_key));

alter table public.club_supplier_order_batches add column if not exists cycle_id uuid references public.club_supplier_order_cycles(id) on delete restrict;
alter table public.club_supplier_demand add column if not exists cycle_id uuid references public.club_supplier_order_cycles(id) on delete restrict;
create unique index if not exists club_supplier_order_batches_cycle_uq on public.club_supplier_order_batches(organisation_id,supplier_id,cycle_id) where cycle_id is not null;
alter table public.club_supplier_order_batch_lines
  add column if not exists member_quantity integer not null default 0,
  add column if not exists replenishment_quantity integer not null default 0,
  add column if not exists replenishment_location_id uuid references public.club_locations(id) on delete restrict;
update public.club_supplier_order_batch_lines set member_quantity=quantity_ordered where member_quantity=0 and replenishment_quantity=0;
alter table public.club_supplier_order_batch_lines drop constraint if exists club_supplier_order_batch_lines_provenance_ck;
alter table public.club_supplier_order_batch_lines add constraint club_supplier_order_batch_lines_provenance_ck check (member_quantity >= 0 and replenishment_quantity >= 0 and member_quantity + replenishment_quantity = quantity_ordered);

create table if not exists public.club_supplier_replenishment_rules (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, product_id uuid not null, supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict,
  minimum_quantity integer not null check (minimum_quantity >= 0), target_quantity integer not null check (target_quantity >= minimum_quantity), enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id,location_id,product_id), foreign key (location_id,organisation_id) references public.club_locations(id,organisation_id), foreign key (product_id,organisation_id) references public.club_commerce_products(id,organisation_id));
create table if not exists public.club_supplier_replenishment_requirements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  cycle_id uuid not null references public.club_supplier_order_cycles(id) on delete restrict, rule_id uuid not null references public.club_supplier_replenishment_rules(id) on delete restrict,
  supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict, location_id uuid not null references public.club_locations(id) on delete restrict,
  quantity_required integer not null check (quantity_required > 0), batch_line_id uuid references public.club_supplier_order_batch_lines(id) on delete restrict,
  created_at timestamptz not null default now(), unique (cycle_id,rule_id));
alter table public.club_supplier_order_cycles enable row level security;
alter table public.club_supplier_replenishment_rules enable row level security;
alter table public.club_supplier_replenishment_requirements enable row level security;
revoke all on public.club_supplier_order_cycles,public.club_supplier_replenishment_rules,public.club_supplier_replenishment_requirements from anon,authenticated;

create or replace function public.club_prepare_supplier_cycle(p_organisation_id uuid,p_supplier_id uuid,p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; c public.club_supplier_order_cycles%rowtype; b public.club_supplier_order_batches%rowtype;
  d record; r record; line_id uuid; local_date date; local_time time; weekday integer; days_to_order integer; after_cutoff boolean; cycle_date date; needed integer; free_stock integer; inbound integer; n integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if;
  select * into s from public.club_suppliers where id=p_supplier_id and organisation_id=p_organisation_id and active for update;
  if not found or not s.ordering_active then raise exception 'Supplier ordering is not configured' using errcode='P0002'; end if;
  if s.cutoff_weekday is null or s.cutoff_local_time is null or s.order_weekday is null then raise exception 'Supplier schedule is incomplete' using errcode='22023'; end if;
  local_date := (p_at at time zone s.timezone)::date; local_time := (p_at at time zone s.timezone)::time; weekday := extract(isodow from local_date)::integer % 7;
  after_cutoff := weekday > s.cutoff_weekday or (weekday=s.cutoff_weekday and local_time>=s.cutoff_local_time);
  days_to_order := (s.order_weekday-weekday+7)%7;
  if after_cutoff then days_to_order:=days_to_order+7; end if;
  cycle_date := local_date+days_to_order;
  insert into public.club_supplier_order_cycles(organisation_id,supplier_id,cycle_key,cutoff_at,order_date,delivery_start_date,delivery_end_date,status)
  values(p_organisation_id,p_supplier_id,cycle_date::text,(((cycle_date-((s.order_weekday-s.cutoff_weekday+7)%7))::date+s.cutoff_local_time) at time zone s.timezone),cycle_date,
    case when s.delivery_start_weekday is null then null else cycle_date+(s.delivery_start_weekday-s.order_weekday+7)%7 end,
    case when s.delivery_end_weekday is null then null else cycle_date+(s.delivery_end_weekday-s.order_weekday+7)%7 end,'open')
  on conflict (organisation_id,supplier_id,cycle_key) do update set updated_at=now() returning * into c;
  select * into b from public.club_supplier_order_batches where organisation_id=p_organisation_id and supplier_id=p_supplier_id and cycle_id=c.id for update;
  if found then return jsonb_build_object('cycle',to_jsonb(c),'batch',to_jsonb(b),'reused',true); end if;
  insert into public.club_supplier_order_counters(organisation_id,next_value) values(p_organisation_id,2) on conflict(organisation_id) do update set next_value=club_supplier_order_counters.next_value+1 returning next_value-1 into n;
  insert into public.club_supplier_order_batches(organisation_id,supplier_id,cycle_id,reference,created_by) values(p_organisation_id,p_supplier_id,c.id,'SUP-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(n::text,4,'0'),auth.uid()) returning * into b;
  for d in select supplier_product_id,sum(quantity_required)::integer quantity from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null group by supplier_product_id loop
    insert into public.club_supplier_order_batch_lines(batch_id,supplier_product_id,quantity_ordered,member_quantity,replenishment_quantity) values(b.id,d.supplier_product_id,d.quantity,d.quantity,0);
    update public.club_supplier_demand set batch_id=b.id,cycle_id=c.id,updated_at=now() where organisation_id=p_organisation_id and supplier_id=p_supplier_id and supplier_product_id=d.supplier_product_id and status='outstanding' and batch_id is null;
  end loop;
  for r in select rr.* from public.club_supplier_replenishment_rules rr join public.club_supplier_products sp on sp.id=rr.supplier_product_id where rr.organisation_id=p_organisation_id and rr.enabled and sp.supplier_id=p_supplier_id and sp.sellable and not sp.discontinued loop
    select coalesce(sum(quantity_delta),0) into free_stock from public.club_stock_movements where organisation_id=p_organisation_id and location_id=r.location_id and product_id=r.product_id;
    select coalesce(sum(greatest(bl.replenishment_quantity-coalesce((select sum(rl.replenishment_quantity_received) from public.club_supplier_receipt_lines rl where rl.batch_line_id=bl.id),0),0)),0) into inbound from public.club_supplier_order_batch_lines bl join public.club_supplier_order_batches bb on bb.id=bl.batch_id where bb.organisation_id=p_organisation_id and bb.supplier_id=p_supplier_id and bb.status in ('draft','ordered','partially_received') and bl.supplier_product_id=r.supplier_product_id;
    if free_stock+inbound<r.minimum_quantity then needed:=greatest(0,r.target_quantity-free_stock-inbound); else needed:=0; end if;
    if needed>0 then
      insert into public.club_supplier_replenishment_requirements(organisation_id,cycle_id,rule_id,supplier_product_id,location_id,quantity_required) values(p_organisation_id,c.id,r.id,r.supplier_product_id,r.location_id,needed) on conflict(cycle_id,rule_id) do update set quantity_required=excluded.quantity_required;
      select id into line_id from public.club_supplier_order_batch_lines where batch_id=b.id and supplier_product_id=r.supplier_product_id;
      if line_id is null then insert into public.club_supplier_order_batch_lines(batch_id,supplier_product_id,quantity_ordered,member_quantity,replenishment_quantity,replenishment_location_id) values(b.id,r.supplier_product_id,needed,0,needed,r.location_id) returning id into line_id;
      else update public.club_supplier_order_batch_lines set quantity_ordered=quantity_ordered+needed,replenishment_quantity=replenishment_quantity+needed where id=line_id; end if;
      update public.club_supplier_replenishment_requirements set batch_line_id=line_id where cycle_id=c.id and rule_id=r.id;
    end if;
  end loop;
  update public.club_supplier_order_cycles set status='prepared',updated_at=now() where id=c.id;
  return jsonb_build_object('cycle',to_jsonb(c),'batch',to_jsonb(b),'reused',false);
end; $$;
revoke all on function public.club_prepare_supplier_cycle(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_prepare_supplier_cycle(uuid,uuid,timestamptz) to authenticated;

create or replace function public.club_supplier_cycle_timing(p_organisation_id uuid,p_supplier_id uuid,p_at timestamptz default now()) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select case when s.cutoff_weekday is null or s.cutoff_local_time is null or s.order_weekday is null or not s.ordering_active then jsonb_build_object('message','Available to order — collection timing confirmed after order') else jsonb_build_object('message','Next supplier cycle · timing configured','timezone',s.timezone,'cutoff_weekday',s.cutoff_weekday,'cutoff_local_time',s.cutoff_local_time,'order_weekday',s.order_weekday,'delivery_start_weekday',s.delivery_start_weekday,'delivery_end_weekday',s.delivery_end_weekday) end from public.club_suppliers s where s.id=p_supplier_id and s.organisation_id=p_organisation_id and s.active;
$$;
revoke all on function public.club_supplier_cycle_timing(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_supplier_cycle_timing(uuid,uuid,timestamptz) to authenticated;

create or replace function public.club_mark_supplier_ordered(p_organisation_id uuid,p_batch_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_supplier_order_batches%rowtype; c public.club_supplier_order_cycles%rowtype;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if;
  select * into b from public.club_supplier_order_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Supplier order not found' using errcode='P0002'; end if;
  if b.status='ordered' then return to_jsonb(b); end if;
  update public.club_supplier_order_batches set status='ordered',ordered_by=auth.uid(),ordered_at=coalesce(ordered_at,now()),updated_at=now() where id=b.id returning * into b;
  update public.club_supplier_demand set status='ordered',ordered_at=b.ordered_at,updated_at=now() where batch_id=b.id and status='outstanding';
  if b.cycle_id is not null then update public.club_supplier_order_cycles set status='ordered',updated_at=now() where id=b.cycle_id returning * into c; end if;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_mark_supplier_ordered(uuid,uuid) from public,anon; grant execute on function public.club_mark_supplier_ordered(uuid,uuid) to authenticated;

-- Receipt lines retain which units are customer allocations versus replenishment.
alter table public.club_supplier_receipt_lines
  add column if not exists member_quantity_received integer not null default 0,
  add column if not exists replenishment_quantity_received integer not null default 0;
update public.club_supplier_receipt_lines set member_quantity_received=quantity_received where member_quantity_received=0 and replenishment_quantity_received=0;
alter table public.club_supplier_receipt_lines drop constraint if exists club_supplier_receipt_lines_provenance_ck;
alter table public.club_supplier_receipt_lines add constraint club_supplier_receipt_lines_provenance_ck check (member_quantity_received >= 0 and replenishment_quantity_received >= 0 and member_quantity_received + replenishment_quantity_received = quantity_received);

create or replace function public.club_receive_supplier_delivery(p_organisation_id uuid,p_batch_id uuid,p_idempotency_key text,p_lines jsonb,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_supplier_order_batches%rowtype; r public.club_supplier_receipts%rowtype; line jsonb; bl public.club_supplier_order_batch_lines%rowtype; prior integer; remaining integer; qty integer; member_qty integer; replenish_qty integer;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Supplier receiving is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Invalid receipt' using errcode='22023'; end if;
  select * into b from public.club_supplier_order_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
  if not found or b.status='draft' then raise exception 'Supplier order is not receivable' using errcode='P0002'; end if;
  select * into r from public.club_supplier_receipts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then if r.batch_id<>b.id then raise exception 'Receipt idempotency key already belongs to another order' using errcode='23505'; end if; return to_jsonb(r); end if;
  insert into public.club_supplier_receipts(organisation_id,batch_id,supplier_id,received_by,idempotency_key,notes) values(p_organisation_id,b.id,b.supplier_id,auth.uid(),p_idempotency_key,p_notes) returning * into r;
  for line in select value from jsonb_array_elements(p_lines) loop
    qty:=coalesce((line->>'quantityReceived')::integer,0);
    select * into bl from public.club_supplier_order_batch_lines where id=(line->>'batchLineId')::uuid and batch_id=b.id for update;
    if not found or qty<1 then raise exception 'Invalid receipt line' using errcode='22023'; end if;
    select coalesce(sum(quantity_received),0) into prior from public.club_supplier_receipt_lines where batch_line_id=bl.id;
    remaining:=bl.quantity_ordered-prior; if qty>remaining then raise exception 'Receipt exceeds ordered quantity' using errcode='22023'; end if;
    select coalesce(sum(member_quantity_received),0) into prior from public.club_supplier_receipt_lines where batch_line_id=bl.id;
    member_qty:=least(qty,greatest(0,bl.member_quantity-prior)); replenish_qty:=qty-member_qty;
    insert into public.club_supplier_receipt_lines(receipt_id,batch_line_id,quantity_received,member_quantity_received,replenishment_quantity_received,notes) values(r.id,bl.id,qty,member_qty,replenish_qty,line->>'notes');
    if replenish_qty>0 then
      if bl.replenishment_location_id is null then raise exception 'Replenishment location is missing' using errcode='22023'; end if;
      insert into public.club_inventory(organisation_id,location_id,product_id) values(p_organisation_id,bl.replenishment_location_id,(select product_id from public.club_supplier_replenishment_rules rr where rr.supplier_product_id=bl.supplier_product_id and rr.location_id=bl.replenishment_location_id limit 1)) on conflict (organisation_id,location_id,product_id) do nothing;
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,actor_user_id,idempotency_key,reason) select p_organisation_id,bl.replenishment_location_id,rr.product_id,'delivery',replenish_qty,auth.uid(),p_idempotency_key||':'||bl.id::text,'Supplier replenishment receipt' from public.club_supplier_replenishment_rules rr where rr.supplier_product_id=bl.supplier_product_id and rr.location_id=bl.replenishment_location_id;
    end if;
  end loop;
  update public.club_supplier_order_batches set status=case when not exists(select 1 from public.club_supplier_order_batch_lines x where x.batch_id=b.id and x.quantity_ordered>coalesce((select sum(quantity_received) from public.club_supplier_receipt_lines where batch_line_id=x.id),0)) then 'received' when exists(select 1 from public.club_supplier_receipt_lines rl join public.club_supplier_order_batch_lines x on x.id=rl.batch_line_id where x.batch_id=b.id) then 'partially_received' else 'ordered' end,updated_at=now() where id=b.id;
  return to_jsonb(r);
end; $$;
revoke all on function public.club_receive_supplier_delivery(uuid,uuid,text,jsonb,text) from public,anon; grant execute on function public.club_receive_supplier_delivery(uuid,uuid,text,jsonb,text) to authenticated;

create or replace function public.club_allocate_supplier_units(p_organisation_id uuid,p_receipt_line_id uuid,p_demand_id uuid,p_quantity integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rl public.club_supplier_receipt_lines%rowtype; d public.club_supplier_demand%rowtype; used integer; ready boolean;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') or p_quantity<1 then raise exception 'Supplier allocation is not permitted' using errcode='42501'; end if;
  select * into rl from public.club_supplier_receipt_lines where id=p_receipt_line_id for update;
  select * into d from public.club_supplier_demand where id=p_demand_id and organisation_id=p_organisation_id for update;
  if not found or rl.id is null then raise exception 'Allocation target not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.club_supplier_order_batch_lines bl join public.club_supplier_receipts r on r.batch_id=bl.batch_id where bl.id=rl.batch_line_id and r.organisation_id=p_organisation_id and bl.supplier_product_id=d.supplier_product_id and d.batch_id=bl.batch_id) then raise exception 'Allocation product or batch mismatch' using errcode='22023'; end if;
  select coalesce(sum(quantity_allocated),0) into used from public.club_supplier_allocations where receipt_line_id=rl.id;
  if used+p_quantity>rl.member_quantity_received or d.quantity_allocated+p_quantity>d.quantity_required then raise exception 'Allocation exceeds available quantity' using errcode='22023'; end if;
  insert into public.club_supplier_allocations(organisation_id,receipt_line_id,demand_id,quantity_allocated,allocated_by) values(p_organisation_id,rl.id,d.id,p_quantity,auth.uid());
  update public.club_supplier_demand set quantity_allocated=quantity_allocated+p_quantity,quantity_received=quantity_received+p_quantity,updated_at=now() where id=d.id returning * into d;
  if d.quantity_allocated>=d.quantity_required then update public.club_supplier_demand set status='ready_for_collection',ready_at=coalesce(ready_at,now()),updated_at=now() where id=d.id; end if;
  select not exists(select 1 from public.club_supplier_demand x where x.order_id=d.order_id and x.status not in ('ready_for_collection','collected','cancelled')) into ready;
  if ready then insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,payload) values(p_organisation_id,d.user_id,'order_ready_for_collection',d.order_id,jsonb_build_object('state','queued')) on conflict(order_id,event_type) do nothing; end if;
  return to_jsonb(d);
end; $$;
revoke all on function public.club_allocate_supplier_units(uuid,uuid,uuid,integer) from public,anon; grant execute on function public.club_allocate_supplier_units(uuid,uuid,uuid,integer) to authenticated;

-- Expose cycle provenance through the existing ordering screen.
create or replace function public.club_list_supplier_order_batches(p_organisation_id uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',b.id,'reference',b.reference,'supplier',s.name,'status',b.status,'created_at',b.created_at,'ordered_at',b.ordered_at,
  'cycle_key',c.cycle_key,'cutoff_at',c.cutoff_at,'order_date',c.order_date,'delivery_start_date',c.delivery_start_date,'delivery_end_date',c.delivery_end_date,
  'lines',(select count(*) from public.club_supplier_order_batch_lines x where x.batch_id=b.id),
  'units',(select coalesce(sum(x.quantity_ordered),0) from public.club_supplier_order_batch_lines x where x.batch_id=b.id),
  'member_units',(select coalesce(sum(x.member_quantity),0) from public.club_supplier_order_batch_lines x where x.batch_id=b.id),
  'replenishment_units',(select coalesce(sum(x.replenishment_quantity),0) from public.club_supplier_order_batch_lines x where x.batch_id=b.id)
) order by b.created_at desc),'[]'::jsonb)
from public.club_supplier_order_batches b join public.club_suppliers s on s.id=b.supplier_id left join public.club_supplier_order_cycles c on c.id=b.cycle_id
where b.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage');
$$;
revoke all on function public.club_list_supplier_order_batches(uuid) from public,anon; grant execute on function public.club_list_supplier_order_batches(uuid) to authenticated;

-- Keep the legacy manual action compatible with line provenance.
create or replace function public.club_create_supplier_order_batch(p_organisation_id uuid,p_supplier_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_supplier_order_batches%rowtype; l record; n integer; ref text;
begin
  if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Supplier ordering is not permitted' using errcode='42501'; end if;
  perform 1 from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null for update;
  if not found then raise exception 'No outstanding supplier demand' using errcode='P0002'; end if;
  insert into public.club_supplier_order_counters(organisation_id,next_value) values(p_organisation_id,2) on conflict(organisation_id) do update set next_value=club_supplier_order_counters.next_value+1 returning next_value-1 into n;
  ref:='SUP-'||to_char(now(),'YYYYMMDD')||'-'||lpad(n::text,4,'0');
  insert into public.club_supplier_order_batches(organisation_id,supplier_id,reference,created_by) values(p_organisation_id,p_supplier_id,ref,auth.uid()) returning * into b;
  for l in select supplier_product_id,sum(quantity_required)::integer quantity from public.club_supplier_demand where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null group by supplier_product_id loop
    insert into public.club_supplier_order_batch_lines(batch_id,supplier_product_id,quantity_ordered,member_quantity,replenishment_quantity) values(b.id,l.supplier_product_id,l.quantity,l.quantity,0);
    update public.club_supplier_demand set batch_id=b.id,updated_at=now() where organisation_id=p_organisation_id and supplier_id=p_supplier_id and status='outstanding' and batch_id is null and supplier_product_id=l.supplier_product_id;
  end loop;
  return to_jsonb(b);
end; $$;
revoke all on function public.club_create_supplier_order_batch(uuid,uuid) from public,anon; grant execute on function public.club_create_supplier_order_batch(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-09-27-club-payment-attempts-split-tender.sql ===
-- Provider-neutral payment attempts and safe Madhouse Balance holds.
-- Review-only: execute after 2026-09-25. No external provider is enabled by this migration.

create table if not exists public.club_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  order_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  external_method text check (external_method is null or external_method in ('card','klarna','clearpay','paypal','bank_transfer')),
  total_minor integer not null check (total_minor > 0),
  balance_amount_minor integer not null default 0 check (balance_amount_minor >= 0),
  external_amount_minor integer not null default 0 check (external_amount_minor >= 0),
  idempotency_key text not null,
  failure_reason text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, idempotency_key),
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete restrict
);

create table if not exists public.club_balance_holds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  account_id uuid not null,
  order_id uuid not null,
  payment_attempt_id uuid not null,
  amount_minor integer not null check (amount_minor > 0),
  status text not null default 'held' check (status in ('held','captured','released')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (organisation_id, idempotency_key),
  unique (payment_attempt_id, organisation_id),
  foreign key (account_id, organisation_id) references public.club_balance_accounts(id, organisation_id) on delete restrict,
  foreign key (order_id, organisation_id) references public.club_orders(id, organisation_id) on delete restrict,
  foreign key (payment_attempt_id, organisation_id) references public.club_payment_attempts(id, organisation_id) on delete restrict
);

alter table public.club_payment_attempts enable row level security;
alter table public.club_balance_holds enable row level security;
revoke all on table public.club_payment_attempts, public.club_balance_holds from public, anon, authenticated;

create or replace function public.club_create_payment_attempt(
  p_organisation_id uuid, p_order_id uuid, p_balance_amount_minor integer,
  p_external_method text, p_external_amount_minor integer, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_account public.club_balance_accounts%rowtype;
  v_attempt public.club_payment_attempts%rowtype;
  v_hold public.club_balance_holds%rowtype;
  v_available integer;
begin
  if auth.uid() is null or p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Payment attempt is not valid' using errcode='42501';
  end if;
  select * into v_order from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update;
  if not found or v_order.status <> 'pending_payment' or v_order.user_id is distinct from auth.uid() then
    raise exception 'Order is not available for payment' using errcode='42501';
  end if;
  if p_balance_amount_minor < 0 or p_external_amount_minor < 0 or p_balance_amount_minor + p_external_amount_minor <> v_order.total_minor then
    raise exception 'Payment amounts do not match order total' using errcode='22023';
  end if;
  if p_external_method is not null and p_external_amount_minor = 0 then
    raise exception 'External payment amount must be positive' using errcode='22023';
  end if;
  if p_external_amount_minor > 0 and p_external_method is null then
    raise exception 'An external payment method is required' using errcode='22023';
  end if;
  if p_external_method is not null and p_external_method not in ('card','klarna','clearpay','paypal','bank_transfer') then
    raise exception 'External payment method is not supported' using errcode='22023';
  end if;
  select * into v_attempt from public.club_payment_attempts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',(select to_jsonb(h) from public.club_balance_holds h where h.payment_attempt_id=v_attempt.id));
  end if;
  -- An order has one active payment attempt at a time. This prevents two external
  -- processors (or two different external methods) being attached concurrently.
  if exists(select 1 from public.club_payment_attempts where organisation_id=p_organisation_id and order_id=p_order_id and status='pending') then
    raise exception 'Another payment attempt is already in progress' using errcode='22023';
  end if;
  if p_balance_amount_minor > 0 then
    select * into v_account from public.club_balance_accounts where organisation_id=p_organisation_id and user_id=auth.uid() and status='active' for update;
    if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
    v_available := coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0)
      - coalesce((select sum(amount_minor) from public.club_balance_holds where account_id=v_account.id and status='held'),0);
    if v_available < p_balance_amount_minor then raise exception 'Insufficient Madhouse Balance' using errcode='22023'; end if;
  end if;
  insert into public.club_payment_attempts(organisation_id,order_id,user_id,total_minor,balance_amount_minor,external_method,external_amount_minor,idempotency_key)
    values(p_organisation_id,p_order_id,auth.uid(),v_order.total_minor,p_balance_amount_minor,p_external_method,p_external_amount_minor,p_idempotency_key) returning * into v_attempt;
  if p_balance_amount_minor > 0 then
    insert into public.club_balance_holds(organisation_id,account_id,order_id,payment_attempt_id,amount_minor,idempotency_key)
      values(p_organisation_id,v_account.id,p_order_id,v_attempt.id,p_balance_amount_minor,p_idempotency_key) returning * into v_hold;
  end if;
  return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',case when v_hold.id is null then null else to_jsonb(v_hold) end);
end; $$;

create or replace function public.club_release_payment_attempt(p_attempt_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_attempt public.club_payment_attempts%rowtype; v_hold public.club_balance_holds%rowtype;
begin
  select * into v_attempt from public.club_payment_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if v_attempt.status='paid' then raise exception 'Paid payment cannot be released' using errcode='22023'; end if;
  update public.club_payment_attempts set status='cancelled',failure_reason=nullif(btrim(p_reason),''),updated_at=now() where id=v_attempt.id returning * into v_attempt;
  update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=v_attempt.id and status='held' returning * into v_hold;
  return jsonb_build_object('attempt',to_jsonb(v_attempt),'hold',case when v_hold.id is null then null else to_jsonb(v_hold) end);
end; $$;

revoke all on function public.club_create_payment_attempt(uuid,uuid,integer,text,integer,text) from public,anon;
revoke all on function public.club_release_payment_attempt(uuid,text) from public,anon;
grant execute on function public.club_create_payment_attempt(uuid,uuid,integer,text,integer,text) to authenticated;
grant execute on function public.club_release_payment_attempt(uuid,text) to authenticated;

comment on table public.club_payment_attempts is 'Provider-neutral pending payment intents. No provider approval or payment success is implied.';
comment on table public.club_balance_holds is 'Temporary internal Madhouse Balance reservations released on failed/cancelled external payment.';

-- A commerce product may optionally point at the existing Club service model.
-- This keeps service fulfilment on its established transaction ledger.
alter table public.club_commerce_products add column if not exists service_id uuid;
do $$ begin
  alter table public.club_commerce_products add constraint club_commerce_products_service_fk
    foreign key (service_id, organisation_id) references public.club_services(id, organisation_id) on delete restrict;
exception when duplicate_object then null;
end $$;
alter table public.club_service_transactions add column if not exists commerce_order_item_id uuid references public.club_order_items(id) on delete restrict;
create unique index if not exists club_service_transactions_order_item_uq on public.club_service_transactions(commerce_order_item_id) where commerce_order_item_id is not null;

-- Trusted provider-callback boundary. This function is intentionally not executable
-- by browser roles; a future provider adapter must call it from a trusted backend.
create or replace function public.club_capture_payment_attempt(p_attempt_id uuid,p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; h public.club_balance_holds%rowtype; o public.club_orders%rowtype; account public.club_balance_accounts%rowtype; entry public.club_balance_entries%rowtype; item public.club_order_items%rowtype; product public.club_commerce_products%rowtype; balance integer; method text; customer uuid;
begin
  if nullif(btrim(p_provider_reference),'') is null then raise exception 'Provider reference is required' using errcode='22023'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if a.status='paid' then return jsonb_build_object('status','paid','attempt',to_jsonb(a)); end if;
  if a.status in ('failed','cancelled') or a.external_amount_minor<=0 or a.external_method is null then raise exception 'Payment attempt cannot be captured' using errcode='22023'; end if;
  select * into o from public.club_orders where id=a.order_id and organisation_id=a.organisation_id for update;
  if not found or o.status<>'pending_payment' then raise exception 'Order is not payable' using errcode='22023'; end if;
  select * into h from public.club_balance_holds where payment_attempt_id=a.id and organisation_id=a.organisation_id for update;
  if h.id is not null and h.status<>'held' then raise exception 'Balance hold is not available' using errcode='22023'; end if;
  if h.id is not null then
    select * into account from public.club_balance_accounts where id=h.account_id and organisation_id=a.organisation_id for update;
    balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=account.id),0);
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,idempotency_key,reason)
      values(account.id,a.organisation_id,'purchase',-h.amount_minor,balance-h.amount_minor,o.id,a.id::text||':balance','Split payment Balance capture') returning * into entry;
    update public.club_balance_holds set status='captured',updated_at=now() where id=h.id;
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
      values(o.id,a.organisation_id,'balance',a.id::text||':balance',h.amount_minor,o.currency,'paid',jsonb_build_object('payment_attempt_id',a.id,'tender','madhouse_balance'));
  end if;
  method:=case when a.external_method='card' then 'card' else 'other' end;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
    values(o.id,a.organisation_id,method,p_provider_reference,a.external_amount_minor,o.currency,'paid',jsonb_build_object('provider',a.external_method,'payment_attempt_id',a.id,'tender','external'));
  update public.club_payment_attempts set status='paid',provider_reference=p_provider_reference,updated_at=now() where id=a.id returning * into a;
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  for item in select * from public.club_order_items where order_id=o.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key)
      values(o.organisation_id,o.location_id,item.product_id,'sale',-item.quantity,o.id,null,a.id::text||':stock:'||item.id) on conflict (organisation_id,idempotency_key) do nothing;
  end loop;
  -- Supplier demand is generated by the paid-payment trigger. Call it explicitly
  -- as well so the trusted capture boundary remains correct if trigger deployment
  -- is staged; the order-item unique index makes this idempotent.
  perform public.club_create_supplier_demand_for_order(o.id);
  for item in select * from public.club_order_items where order_id=o.id loop
    select * into product from public.club_commerce_products where id=item.product_id and organisation_id=o.organisation_id;
    if product.service_id is not null then
      if o.location_id is null then raise exception 'Service order requires a location' using errcode='22023'; end if;
      customer:=o.customer_id;
      if customer is null and o.user_id is not null then select id into customer from public.club_customers where organisation_id=o.organisation_id and user_id=o.user_id limit 1; end if;
      insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,commerce_order_item_id,metadata)
        values(o.organisation_id,o.location_id,product.service_id,customer,item.quantity,item.unit_price_minor,o.currency,'paid',method,a.id::text,'fulfilled',item.id,jsonb_build_object('order_id',o.id,'payment_attempt_id',a.id))
        on conflict (commerce_order_item_id) do nothing;
    end if;
  end loop;
  return jsonb_build_object('status','paid','attempt',to_jsonb(a),'balance_entry',case when entry.id is null then null else to_jsonb(entry) end);
end; $$;
revoke all on function public.club_capture_payment_attempt(uuid,text) from public,anon,authenticated;
-- Supabase's trusted service role is the only executable provider-callback route.
grant execute on function public.club_capture_payment_attempt(uuid,text) to service_role;

create or replace function public.club_fail_payment_attempt(p_attempt_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; h public.club_balance_holds%rowtype;
begin
  select * into a from public.club_payment_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if a.status='paid' then raise exception 'Paid payment cannot fail' using errcode='22023'; end if;
  if a.status='failed' then return jsonb_build_object('attempt',to_jsonb(a)); end if;
  update public.club_payment_attempts set status='failed',failure_reason=nullif(btrim(p_reason),''),updated_at=now() where id=a.id returning * into a;
  update public.club_balance_holds set status='released',updated_at=now() where payment_attempt_id=a.id and status='held' returning * into h;
  return jsonb_build_object('attempt',to_jsonb(a),'hold',case when h.id is null then null else to_jsonb(h) end);
end; $$;
revoke all on function public.club_fail_payment_attempt(uuid,text) from public,anon;
grant execute on function public.club_fail_payment_attempt(uuid,text) to authenticated;

-- Read-only member recovery state; identity is derived from auth.uid().
create or replace function public.club_get_payment_attempt(p_attempt_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('attempt',to_jsonb(a),'hold',(select to_jsonb(h) from public.club_balance_holds h where h.payment_attempt_id=a.id))
from public.club_payment_attempts a where a.id=p_attempt_id and a.user_id=auth.uid();
$$;
revoke all on function public.club_get_payment_attempt(uuid) from public,anon;
grant execute on function public.club_get_payment_attempt(uuid) to authenticated;

-- Shared paid-order finalisation. Every successful tender path must call this
-- primitive after marking the order paid. Its idempotency keys and the
-- commerce-order-item unique service index make retries safe.
create or replace function public.club_finalize_paid_order(p_order_id uuid, p_actor_user_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_item public.club_order_items%rowtype;
  v_product public.club_commerce_products%rowtype;
  v_customer uuid;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found or v_order.status <> 'paid' then
    raise exception 'Paid order is required for finalisation' using errcode='22023';
  end if;
  for v_item in select * from public.club_order_items where order_id=v_order.id order by id loop
    if v_item.stock_tracked then
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key)
      values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,p_actor_user_id,'order-finalise:'||v_item.id::text)
      on conflict (organisation_id,idempotency_key) do nothing;
    end if;
    select * into v_product from public.club_commerce_products where id=v_item.product_id and organisation_id=v_order.organisation_id;
    if v_product.service_id is not null then
      if v_order.location_id is null then raise exception 'Service order requires a location' using errcode='22023'; end if;
      v_customer:=v_order.customer_id;
      if v_customer is null and v_order.user_id is not null then
        select id into v_customer from public.club_customers where organisation_id=v_order.organisation_id and user_id=v_order.user_id limit 1;
      end if;
      insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,commerce_order_item_id,metadata)
      values(v_order.organisation_id,v_order.location_id,v_product.service_id,v_customer,p_actor_user_id,v_item.quantity,v_item.unit_price_minor,v_order.currency,'paid','commerce',v_order.id::text,'pending',v_item.id,jsonb_build_object('commerce_order_id',v_order.id))
      on conflict (commerce_order_item_id) do nothing;
    end if;
  end loop;
  perform public.club_create_supplier_demand_for_order(v_order.id);
end; $$;
revoke all on function public.club_finalize_paid_order(uuid,uuid) from public,anon,authenticated;

-- Final provider capture delegates all fulfilment effects to the shared
-- primitive. It remains callable only by the trusted service role.
create or replace function public.club_capture_payment_attempt(p_attempt_id uuid,p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_payment_attempts%rowtype; h public.club_balance_holds%rowtype; o public.club_orders%rowtype; account public.club_balance_accounts%rowtype; entry public.club_balance_entries%rowtype; method text;
begin
  if nullif(btrim(p_provider_reference),'') is null then raise exception 'Provider reference is required' using errcode='22023'; end if;
  select * into a from public.club_payment_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Payment attempt not found' using errcode='P0002'; end if;
  if a.status='paid' then return jsonb_build_object('status','paid','attempt',to_jsonb(a)); end if;
  if a.status in ('failed','cancelled') or a.external_amount_minor<=0 or a.external_method is null then raise exception 'Payment attempt cannot be captured' using errcode='22023'; end if;
  select * into o from public.club_orders where id=a.order_id and organisation_id=a.organisation_id for update;
  if not found or o.status<>'pending_payment' then raise exception 'Order is not payable' using errcode='22023'; end if;
  select * into h from public.club_balance_holds where payment_attempt_id=a.id and organisation_id=a.organisation_id for update;
  if h.id is not null then
    if h.status<>'held' then raise exception 'Balance hold is not available' using errcode='22023'; end if;
    select * into account from public.club_balance_accounts where id=h.account_id and organisation_id=a.organisation_id for update;
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,idempotency_key,reason)
    values(account.id,a.organisation_id,'purchase',-h.amount_minor,coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=account.id),0)-h.amount_minor,o.id,a.id::text||':balance','Split payment Balance capture') returning * into entry;
    update public.club_balance_holds set status='captured',updated_at=now() where id=h.id;
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
    values(o.id,a.organisation_id,'balance',a.id::text||':balance',h.amount_minor,o.currency,'paid',jsonb_build_object('payment_attempt_id',a.id,'tender','madhouse_balance'));
  end if;
  method:=case when a.external_method='card' then 'card' else 'other' end;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status,metadata)
  values(o.id,a.organisation_id,method,p_provider_reference,a.external_amount_minor,o.currency,'paid',jsonb_build_object('provider',a.external_method,'payment_attempt_id',a.id,'tender','external'));
  update public.club_payment_attempts set status='paid',provider_reference=p_provider_reference,updated_at=now() where id=a.id returning * into a;
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,null);
  return jsonb_build_object('status','paid','attempt',to_jsonb(a),'balance_entry',case when entry.id is null then null else to_jsonb(entry) end);
end; $$;
revoke all on function public.club_capture_payment_attempt(uuid,text) from public,anon,authenticated;
grant execute on function public.club_capture_payment_attempt(uuid,text) to service_role;

-- Cash verification is also a paid-order boundary; retain the declaration
-- safety checks while routing confirmed orders through shared finalisation.
create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_cash_declarations%rowtype; v_order public.club_orders%rowtype;
begin
  select * into v_row from public.club_cash_declarations where id=p_declaration_id for update;
  if not found or not public.club_has_active_role(v_row.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if v_row.status<> 'declared' then if v_row.status=p_status then return to_jsonb(v_row); else raise exception 'Cash declaration decision conflicts' using errcode='23505'; end if; end if;
  if p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  if v_row.purpose='commerce_order' then
    select * into v_order from public.club_orders where id=v_row.order_id and organisation_id=v_row.organisation_id for update;
    if p_status='confirmed' then
      if not found or v_order.status<>'awaiting_cash_verification' then raise exception 'Order is not awaiting cash confirmation' using errcode='22023'; end if;
      insert into public.club_payments(order_id,organisation_id,method,amount_minor,currency,status,external_reference) values(v_order.id,v_order.organisation_id,'cash',v_order.total_minor,v_order.currency,'paid',coalesce(v_row.idempotency_key,v_row.id::text)) on conflict do nothing;
      update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
      perform public.club_finalize_paid_order(v_order.id,auth.uid());
    elsif found and v_order.status='awaiting_cash_verification' then update public.club_orders set status='cash_disputed',updated_at=now() where id=v_order.id; end if;
  end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end; $$;

-- Existing direct settlement RPCs use the same finalisation boundary.
create or replace function public.club_record_cash_payment(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; p public.club_payments%rowtype; existing public.club_payments%rowtype;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_has_active_role(o.organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Cash settlement is not permitted' using errcode='42501'; end if;
  if o.status in ('awaiting_cash_verification','cash_disputed') then raise exception 'Order requires cash declaration resolution' using errcode='22023'; end if;
  if p_amount_minor<>o.total_minor or p_amount_minor<0 or o.status<>'pending_payment' then raise exception 'Order is not eligible for cash settlement' using errcode='22023'; end if;
  select * into existing from public.club_payments where organisation_id=o.organisation_id and external_reference=p_idempotency_key and order_id=o.id;
  if found then return to_jsonb(existing); end if;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(o.id,o.organisation_id,'cash',p_idempotency_key,p_amount_minor,o.currency,'paid') returning * into p;
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,auth.uid());
  return to_jsonb(p);
end; $$;

create or replace function public.club_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; a public.club_balance_accounts%rowtype; e public.club_balance_entries%rowtype; prior public.club_balance_entries%rowtype; b integer;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or o.user_id is distinct from auth.uid() then raise exception 'Balance spend is not permitted' using errcode='42501'; end if;
  if o.status in ('awaiting_cash_verification','cash_disputed') then raise exception 'Order requires cash declaration resolution' using errcode='22023'; end if;
  select * into a from public.club_balance_accounts where organisation_id=o.organisation_id and user_id=auth.uid() for update;
  if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  select * into prior from public.club_balance_entries where organisation_id=o.organisation_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(prior); end if;
  if p_amount_minor<=0 or p_amount_minor<>o.total_minor or o.status<>'pending_payment' then raise exception 'Balance settlement is not eligible' using errcode='22023'; end if;
  b:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=a.id),0);
  if b<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(a.id,o.organisation_id,'purchase',-p_amount_minor,b-p_amount_minor,o.id,auth.uid(),p_idempotency_key) returning * into e;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(o.id,o.organisation_id,'balance',p_idempotency_key,p_amount_minor,o.currency,'paid');
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,auth.uid());
  return to_jsonb(e);
end; $$;

create or replace function public.club_staff_spend_balance(p_order_id uuid,p_amount_minor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; a public.club_balance_accounts%rowtype; e public.club_balance_entries%rowtype; prior public.club_balance_entries%rowtype; b integer;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found or auth.uid() is null or not public.club_capability_allowed(o.organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Balance sale is not permitted' using errcode='42501'; end if;
  if o.customer_id is null or o.status<>'pending_payment' or p_amount_minor<>o.total_minor or p_amount_minor<=0 then raise exception 'Order is not eligible for balance payment' using errcode='22023'; end if;
  select * into a from public.club_balance_accounts where organisation_id=o.organisation_id and customer_id=o.customer_id for update;
  if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
  select * into prior from public.club_balance_entries where organisation_id=o.organisation_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(prior); end if;
  b:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=a.id),0); if b<p_amount_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
  insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key) values(a.id,o.organisation_id,'purchase',-p_amount_minor,b-p_amount_minor,o.id,auth.uid(),p_idempotency_key) returning * into e;
  insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status) values(o.id,o.organisation_id,'balance',p_idempotency_key,p_amount_minor,o.currency,'paid');
  update public.club_orders set status='paid',updated_at=now() where id=o.id;
  perform public.club_finalize_paid_order(o.id,auth.uid());
  return to_jsonb(e);
end; $$;


-- === APPLY supabase/migrations/2026-09-28-club-membership-billing-dunning.sql ===
-- Provider-neutral recurring membership billing and recovery lifecycle.
-- No provider credentials or historical payments are fabricated by this migration.

create table if not exists public.club_membership_billing_policies (
  organisation_id uuid primary key references public.club_organisations(id) on delete cascade,
  grace_period_days integer check (grace_period_days is null or grace_period_days >= 0),
  suspend_after_days integer check (suspend_after_days is null or suspend_after_days >= 0),
  max_retries integer not null default 0 check (max_retries >= 0),
  retry_intervals_days integer[] not null default '{}',
  late_fee_enabled boolean not null default false,
  late_fee_amount_minor integer check (late_fee_amount_minor is null or late_fee_amount_minor > 0),
  access_suspension_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.club_membership_billing_arrangements (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  membership_id uuid not null, user_id uuid not null references auth.users(id) on delete restrict, customer_id uuid,
  provider_type text, payment_method_family text not null default 'other' check (payment_method_family in ('direct_debit','recurring_card','other')),
  provider_customer_reference text, provider_subscription_reference text, amount_minor integer not null check (amount_minor > 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','annual','other')), next_due_at timestamptz not null,
  state text not null default 'active' check (state in ('active','cancelled')), last_successful_payment_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, organisation_id), unique (organisation_id, membership_id),
  foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete set null
);

create table if not exists public.club_membership_billing_obligations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  arrangement_id uuid,
  membership_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_id uuid,
  provider_type text,
  payment_method_family text not null default 'other' check (payment_method_family in ('direct_debit','recurring_card','other')),
  provider_customer_reference text,
  provider_subscription_reference text,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','annual','other')),
  next_due_at timestamptz not null,
  period_key text not null,
  state text not null default 'upcoming' check (state in ('upcoming','due','payment_pending','paid','failed','grace','retry_scheduled','recovered','overdue','waived','cancelled')),
  last_paid_at timestamptz,
  last_payment_reference text,
  failure_reason text,
  grace_started_at timestamptz,
  recovery_exhausted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (arrangement_id, period_key),
  unique (id, organisation_id),
  foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete set null,
  foreign key (arrangement_id, organisation_id) references public.club_membership_billing_arrangements(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_reference text,
  provider_event_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organisation_id, provider_event_key),
  unique (obligation_id, provider_reference),
  foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_retries (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null, retry_number integer not null check (retry_number > 0), strategy text not null check (strategy in ('provider_managed','r12_requested')),
  scheduled_at timestamptz, requested_at timestamptz, attempted_at timestamptz, result text check (result is null or result in ('pending','succeeded','failed','unavailable','cancelled')),
  provider_reference text, failure_reason text, created_at timestamptz not null default now(),
  unique (obligation_id, retry_number, strategy), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_late_fees (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null, amount_minor integer not null check (amount_minor > 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
  state text not null default 'outstanding' check (state in ('outstanding','waived','settled')), waived_by uuid references auth.users(id) on delete set null, waived_at timestamptz, reason text, created_at timestamptz not null default now(),
  unique (obligation_id), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_notifications (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  obligation_id uuid not null, user_id uuid not null references auth.users(id) on delete restrict, notification_type text not null,
  channel text, state text not null default 'unavailable' check (state in ('pending','unavailable','sent','failed')),
  provider_reference text, idempotency_key text not null, created_at timestamptz not null default now(), sent_at timestamptz,
  unique (organisation_id, idempotency_key), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create table if not exists public.club_membership_billing_provider_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  provider_type text not null, provider_event_key text not null, event_type text not null, obligation_id uuid, payload jsonb not null default '{}', received_at timestamptz not null default now(),
  unique (organisation_id, provider_type, provider_event_key), foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete set null
);

create table if not exists public.club_membership_payment_access_suspensions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  membership_id uuid not null, user_id uuid not null references auth.users(id) on delete restrict, obligation_id uuid not null,
  reason text not null default 'payment_overdue', active boolean not null default true, created_at timestamptz not null default now(), cleared_at timestamptz,
  unique (obligation_id), foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id) on delete restrict,
  foreign key (obligation_id, organisation_id) references public.club_membership_billing_obligations(id, organisation_id) on delete restrict
);

create index if not exists club_billing_obligations_due_idx on public.club_membership_billing_obligations(organisation_id,state,next_due_at);
create index if not exists club_billing_notifications_obligation_idx on public.club_membership_billing_notifications(organisation_id,obligation_id,created_at desc);
alter table public.club_membership_billing_policies enable row level security;
alter table public.club_membership_billing_arrangements enable row level security;
alter table public.club_membership_billing_obligations enable row level security;
alter table public.club_membership_billing_payments enable row level security;
alter table public.club_membership_billing_retries enable row level security;
alter table public.club_membership_billing_late_fees enable row level security;
alter table public.club_membership_billing_notifications enable row level security;
alter table public.club_membership_billing_provider_events enable row level security;
alter table public.club_membership_payment_access_suspensions enable row level security;
revoke all on table public.club_membership_billing_policies,public.club_membership_billing_arrangements,public.club_membership_billing_obligations,public.club_membership_billing_payments,public.club_membership_billing_retries,public.club_membership_billing_late_fees,public.club_membership_billing_notifications,public.club_membership_billing_provider_events,public.club_membership_payment_access_suspensions from public,anon,authenticated;

create or replace function public.club_next_membership_billing_due(p_due_at timestamptz,p_frequency text)
returns timestamptz language plpgsql immutable as $$
declare months integer; target date; day integer; last_day integer;
begin
  if p_frequency='weekly' then return p_due_at + interval '7 days'; end if;
  if p_frequency='annual' then return p_due_at + interval '1 year'; end if;
  if p_frequency not in ('monthly','quarterly') then return null; end if;
  months:=case when p_frequency='monthly' then 1 else 3 end;
  day:=extract(day from p_due_at)::integer;
  target:=(date_trunc('month',p_due_at)::date + (months||' months')::interval)::date;
  last_day:=extract(day from (date_trunc('month',target::timestamp)+interval '1 month - 1 day'))::integer;
  return target + (least(day,last_day)-1) * interval '1 day' + (p_due_at-date_trunc('day',p_due_at));
end;
$$;

create or replace function public.club_enrol_membership_billing(p_organisation_id uuid,p_membership_id uuid,p_user_id uuid,p_customer_id uuid,p_provider_type text,p_payment_method_family text,p_amount_minor integer,p_currency text,p_frequency text,p_next_due_at timestamptz,p_provider_customer_reference text,p_provider_subscription_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; a public.club_membership_billing_arrangements%rowtype; o public.club_membership_billing_obligations%rowtype; period text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing administration is not permitted' using errcode='42501'; end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for share;
  if not found or not exists(select 1 from public.club_membership_holders where membership_id=m.id and user_id=p_user_id) then raise exception 'Membership billing identity is invalid' using errcode='22023'; end if;
  if p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_payment_method_family not in ('direct_debit','recurring_card','other') or p_frequency not in ('weekly','monthly','quarterly','annual','other') or p_next_due_at is null then raise exception 'Invalid billing obligation' using errcode='22023'; end if;
  insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,provider_customer_reference,provider_subscription_reference)
  values(p_organisation_id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,p_amount_minor,p_currency,p_frequency,p_next_due_at,p_provider_customer_reference,p_provider_subscription_reference)
  on conflict (organisation_id,membership_id) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,provider_type=excluded.provider_type,payment_method_family=excluded.payment_method_family,amount_minor=excluded.amount_minor,currency=excluded.currency,frequency=excluded.frequency,next_due_at=excluded.next_due_at,provider_customer_reference=excluded.provider_customer_reference,provider_subscription_reference=excluded.provider_subscription_reference,state='active',updated_at=now()
  returning * into a;
  period:=to_char(p_next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,amount_minor,currency,frequency,next_due_at,period_key)
  values(p_organisation_id,a.id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,p_amount_minor,p_currency,p_frequency,p_next_due_at,period)
  on conflict (arrangement_id,period_key) do nothing returning * into o;
  if o.id is null then select * into o from public.club_membership_billing_obligations where arrangement_id=a.id and period_key=period; end if;
  return jsonb_build_object('arrangement',to_jsonb(a),'obligation',to_jsonb(o));
end; $$;

create or replace function public.club_ingest_membership_payment_event(p_organisation_id uuid,p_provider_type text,p_provider_event_key text,p_event_type text,p_obligation_id uuid,p_amount_minor integer,p_currency text,p_provider_reference text,p_failure_reason text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; a public.club_membership_billing_arrangements%rowtype; e public.club_membership_billing_provider_events%rowtype; paid public.club_membership_billing_payments%rowtype; next_due timestamptz; next_period text;
begin
  if p_provider_event_key is null or p_event_type not in ('payment_submitted','payment_confirmed','payment_failed','retry_scheduled','payment_cancelled','mandate_cancelled') then raise exception 'Invalid provider event' using errcode='22023'; end if;
  select * into e from public.club_membership_billing_provider_events where organisation_id=p_organisation_id and provider_type=p_provider_type and provider_event_key=p_provider_event_key;
  if found then return to_jsonb(e); end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Billing obligation not found' using errcode='P0002'; end if;
  insert into public.club_membership_billing_provider_events(organisation_id,provider_type,provider_event_key,event_type,obligation_id,payload) values(p_organisation_id,p_provider_type,p_provider_event_key,p_event_type,p_obligation_id,jsonb_build_object('amount_minor',p_amount_minor,'currency',p_currency,'provider_reference',p_provider_reference)) returning * into e;
  if p_event_type='payment_confirmed' then
    if p_amount_minor<>o.amount_minor or p_currency<>o.currency then raise exception 'Payment amount does not match obligation' using errcode='22023'; end if;
    insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key,occurred_at) values(p_organisation_id,o.id,p_amount_minor,p_currency,p_provider_reference,p_provider_event_key,coalesce(p_occurred_at,now())) on conflict (organisation_id,provider_event_key) do nothing returning * into paid;
    update public.club_membership_billing_obligations set state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,last_paid_at=coalesce(p_occurred_at,now()),last_payment_reference=p_provider_reference,failure_reason=null,grace_started_at=null,recovery_exhausted_at=null,updated_at=now() where id=o.id;
    select * into a from public.club_membership_billing_arrangements where id=o.arrangement_id and organisation_id=o.organisation_id for update;
    next_due:=public.club_next_membership_billing_due(a.next_due_at,a.frequency);
    if next_due is not null and a.next_due_at<=o.next_due_at then
      next_period:=to_char(next_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_customer_reference,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,period_key)
      values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,a.provider_type,a.payment_method_family,a.provider_customer_reference,a.provider_subscription_reference,a.amount_minor,a.currency,a.frequency,next_due,next_period) on conflict (arrangement_id,period_key) do nothing;
      update public.club_membership_billing_arrangements set next_due_at=next_due,last_successful_payment_at=coalesce(p_occurred_at,now()),updated_at=now() where id=a.id;
    end if;
    update public.club_membership_payment_access_suspensions set active=false,cleared_at=now() where obligation_id=o.id and active;
  elsif p_event_type='payment_failed' then update public.club_membership_billing_obligations set state='grace',failure_reason=p_failure_reason,grace_started_at=coalesce(grace_started_at,coalesce(p_occurred_at,now())),updated_at=now() where id=o.id;
  elsif p_event_type='retry_scheduled' then update public.club_membership_billing_obligations set state='retry_scheduled',updated_at=now() where id=o.id;
  elsif p_event_type in ('payment_cancelled','mandate_cancelled') then update public.club_membership_billing_obligations set state='overdue',failure_reason=coalesce(p_failure_reason,'Payment method cancelled'),updated_at=now() where id=o.id;
  end if;
  return jsonb_build_object('event',to_jsonb(e),'obligation',(select to_jsonb(x) from public.club_membership_billing_obligations x where x.id=o.id),'payment',case when paid.id is null then null else to_jsonb(paid) end);
end; $$;

create or replace function public.club_evaluate_membership_billing(p_organisation_id uuid,p_as_of timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_membership_billing_policies%rowtype; o public.club_membership_billing_obligations%rowtype; changed integer:=0; overdue_days integer; stage text; key text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing evaluation is not permitted' using errcode='42501'; end if;
  select * into p from public.club_membership_billing_policies where organisation_id=p_organisation_id;
  for o in select * from public.club_membership_billing_obligations where organisation_id=p_organisation_id and state not in ('paid','recovered','cancelled','waived') for update loop
    if o.next_due_at<=p_as_of and o.state='upcoming' then update public.club_membership_billing_obligations set state='due',updated_at=now() where id=o.id; changed:=changed+1; end if;
    if o.next_due_at<=p_as_of and o.state in ('due','payment_pending','failed') then update public.club_membership_billing_obligations set state='grace',grace_started_at=coalesce(grace_started_at,o.next_due_at),updated_at=now() where id=o.id; end if;
    overdue_days:=greatest(0,floor(extract(epoch from (p_as_of-coalesce(o.grace_started_at,o.next_due_at)))/86400)::integer);
    if coalesce(p.late_fee_enabled,false) and coalesce(p.late_fee_amount_minor,0)>0 and overdue_days>0 then insert into public.club_membership_billing_late_fees(organisation_id,obligation_id,amount_minor,currency) values(p_organisation_id,o.id,p.late_fee_amount_minor,o.currency) on conflict (obligation_id) do nothing; end if;
    if coalesce(p.suspend_after_days,2147483647)<=overdue_days and coalesce(p.access_suspension_enabled,false) then
      update public.club_membership_billing_obligations set state='overdue',recovery_exhausted_at=coalesce(recovery_exhausted_at,p_as_of),updated_at=now() where id=o.id;
      insert into public.club_membership_payment_access_suspensions(organisation_id,membership_id,user_id,obligation_id) values(p_organisation_id,o.membership_id,o.user_id,o.id) on conflict (obligation_id) do update set active=true,cleared_at=null;
    end if;
    stage:=case when overdue_days=0 then 'payment_failed' when overdue_days=coalesce(p.grace_period_days,0) then 'grace_reminder' when coalesce(p.suspend_after_days,2147483647)<=overdue_days then 'access_suspended' else 'payment_failed' end;
    key:='billing:'||o.id::text||':'||stage;
    insert into public.club_membership_billing_notifications(organisation_id,obligation_id,user_id,notification_type,idempotency_key) values(p_organisation_id,o.id,o.user_id,stage,key) on conflict (organisation_id,idempotency_key) do nothing;
  end loop;
  return jsonb_build_object('organisation_id',p_organisation_id,'evaluated_at',p_as_of,'changed',changed);
end; $$;

create or replace function public.club_list_membership_billing_attention(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing access is not permitted' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'user_id',o.user_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'state',o.state,'failure_reason',o.failure_reason,'payment_method_family',o.payment_method_family,'grace_started_at',o.grace_started_at,'recovery_exhausted_at',o.recovery_exhausted_at) order by o.next_due_at), '[]'::jsonb) into result
  from public.club_membership_billing_obligations o where o.organisation_id=p_organisation_id and o.state in ('due','failed','grace','retry_scheduled','overdue');
  return result;
end; $$;

create or replace function public.club_get_member_billing(p_organisation_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'arrangement_id',o.arrangement_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'arrangement_next_due_at',a.next_due_at,'frequency',a.frequency,'state',o.state,'payment_method_family',a.payment_method_family,'grace_started_at',o.grace_started_at,'failure_reason',o.failure_reason) order by o.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id where o.organisation_id=p_organisation_id and o.user_id=p_user_id and auth.uid()=p_user_id;
$$;

create or replace function public.club_save_membership_billing_policy(p_organisation_id uuid,p_grace_period_days integer,p_suspend_after_days integer,p_max_retries integer,p_retry_intervals_days integer[],p_late_fee_enabled boolean,p_late_fee_amount_minor integer,p_access_suspension_enabled boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.club_membership_billing_policies%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing policy administration is not permitted' using errcode='42501'; end if;
  if p_grace_period_days is not null and p_grace_period_days<0 or p_suspend_after_days is not null and p_suspend_after_days<0 or p_max_retries<0 or p_late_fee_amount_minor is not null and p_late_fee_amount_minor<=0 then raise exception 'Invalid billing policy' using errcode='22023'; end if;
  insert into public.club_membership_billing_policies(organisation_id,grace_period_days,suspend_after_days,max_retries,retry_intervals_days,late_fee_enabled,late_fee_amount_minor,access_suspension_enabled,updated_by,updated_at)
  values(p_organisation_id,p_grace_period_days,p_suspend_after_days,p_max_retries,coalesce(p_retry_intervals_days,'{}'),p_late_fee_enabled,p_late_fee_amount_minor,p_access_suspension_enabled,auth.uid(),now())
  on conflict (organisation_id) do update set grace_period_days=excluded.grace_period_days,suspend_after_days=excluded.suspend_after_days,max_retries=excluded.max_retries,retry_intervals_days=excluded.retry_intervals_days,late_fee_enabled=excluded.late_fee_enabled,late_fee_amount_minor=excluded.late_fee_amount_minor,access_suspension_enabled=excluded.access_suspension_enabled,updated_by=excluded.updated_by,updated_at=now()
  returning * into p;
  return to_jsonb(p);
end; $$;

create or replace function public.club_waive_membership_late_fee(p_organisation_id uuid,p_late_fee_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.club_membership_billing_late_fees%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') or nullif(btrim(p_reason),'') is null then raise exception 'Late-fee waiver is not permitted' using errcode='42501'; end if;
  update public.club_membership_billing_late_fees set state='waived',waived_by=auth.uid(),waived_at=now(),reason=p_reason where id=p_late_fee_id and organisation_id=p_organisation_id and state='outstanding' returning * into f;
  if not found then raise exception 'Late fee is not available' using errcode='P0002'; end if;
  return to_jsonb(f);
end; $$;

revoke all on function public.club_enrol_membership_billing(uuid,uuid,uuid,uuid,text,text,integer,text,text,timestamptz,text,text),public.club_evaluate_membership_billing(uuid,timestamptz),public.club_list_membership_billing_attention(uuid),public.club_get_member_billing(uuid,uuid),public.club_save_membership_billing_policy(uuid,integer,integer,integer,integer[],boolean,integer,boolean),public.club_waive_membership_late_fee(uuid,uuid,text) from public,anon;
revoke all on function public.club_ingest_membership_payment_event(uuid,text,text,text,uuid,integer,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.club_enrol_membership_billing(uuid,uuid,uuid,uuid,text,text,integer,text,text,timestamptz,text,text),public.club_evaluate_membership_billing(uuid,timestamptz),public.club_list_membership_billing_attention(uuid),public.club_get_member_billing(uuid,uuid),public.club_save_membership_billing_policy(uuid,integer,integer,integer,integer[],boolean,integer,boolean),public.club_waive_membership_late_fee(uuid,uuid,text) to authenticated;
grant execute on function public.club_ingest_membership_payment_event(uuid,text,text,text,uuid,integer,text,text,text,timestamptz) to service_role;

-- Payment suspension is an additive access restriction: induction, location
-- scope and every existing access rule still run through the established base.
create or replace function public.club_check_member_location_access(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare base jsonb; induction jsonb;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])) then raise exception 'Location eligibility is not permitted' using errcode='42501'; end if;
  if exists(select 1 from public.club_membership_payment_access_suspensions where organisation_id=p_organisation_id and user_id=p_user_id and active) then
    return jsonb_build_object('allowed',false,'organisation_id',p_organisation_id,'location_id',p_location_id,'reason','payment_overdue');
  end if;
  base:=public.club_check_member_location_access_base(p_organisation_id,p_user_id,p_location_id,p_at);
  if base->>'allowed' <> 'true' then return base; end if;
  induction:=public.club_get_member_induction_state(p_organisation_id,p_user_id,p_location_id,p_at);
  if induction->'state'->>'access_effect'='hold' then return base||jsonb_build_object('allowed',false,'reason','induction_overdue','induction',induction->'state'); end if;
  return base||jsonb_build_object('induction',induction->'state');
end; $$;
revoke all on function public.club_check_member_location_access(uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.club_check_member_location_access(uuid,uuid,uuid,timestamptz) to authenticated;

comment on table public.club_membership_billing_obligations is 'Provider-neutral recurring obligations; existing imported members may start here without fabricated payment history.';
comment on table public.club_membership_billing_notifications is 'Internal communication intent. Unconfigured channels remain unavailable, never falsely sent.';


-- === APPLY supabase/migrations/2026-09-29-club-shelf-removals-discounts.sql ===
-- Collection shelf confirmation, manual shelf reminders, stock removals and
-- auditable discounts. No automatic pickup inference or provider messaging.

-- Extend the live capability vocabulary with a focused stock-removal permission.
alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'));
create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false when p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then false when exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role='owner' and p_capability='staff.permissions_manage') then true when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='deny') then false when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='allow') then true else exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and ((m.role='owner' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage')) or (m.role='gym_admin' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage')) or (m.role='gym_staff' and p_capability in ('members.view','members.create','members.link_account','payments.take','payments.record_cash','cash.reconcile','supplier.receive','commerce.collections_manage')) or (m.role='trainer' and p_capability='members.view'))) end;
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;
create or replace function public.club_save_staff_permission(p_organisation_id uuid,p_user_id uuid,p_capability text,p_decision text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_staff_permission_overrides%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Staff permissions require owner access' using errcode='42501'; end if;
 if p_decision not in ('allow','deny') or p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then raise exception 'Invalid permission' using errcode='22023'; end if;
 if p_capability='staff.permissions_manage' and p_decision='allow' and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='owner') then raise exception 'Owner capability cannot be granted to non-owner' using errcode='42501'; end if;
 if p_capability='staff.permissions_manage' and p_decision='deny' and p_user_id=auth.uid() then raise exception 'Owner administration cannot be denied' using errcode='42501'; end if;
 if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role in ('gym_staff','gym_admin','owner')) then raise exception 'Operational staff member not found' using errcode='P0002'; end if;
 insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by) values(p_organisation_id,p_user_id,p_capability,p_decision,auth.uid()) on conflict(organisation_id,user_id,capability) do update set decision=excluded.decision,created_by=excluded.created_by,created_at=now() returning * into r;
 return to_jsonb(r);
end; $$;
revoke all on function public.club_save_staff_permission(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_save_staff_permission(uuid,uuid,text,text) to authenticated;

alter table public.club_supplier_demand add column if not exists collection_code text;
alter table public.club_supplier_demand add column if not exists shelf_confirmed_at timestamptz;
alter table public.club_supplier_demand add column if not exists shelf_confirmed_by uuid references auth.users(id) on delete set null;
update public.club_supplier_demand set collection_code=coalesce(collection_code,'COL-'||replace(id::text,'-','')) where collection_code is null;
alter table public.club_supplier_demand alter column collection_code set default ('COL-'||replace(gen_random_uuid()::text,'-',''));
alter table public.club_supplier_demand alter column collection_code set not null;
create unique index if not exists club_supplier_demand_collection_code_uq on public.club_supplier_demand(organisation_id,collection_code);
create table if not exists public.club_collection_reminder_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, demand_id uuid not null, order_id uuid not null, actor_user_id uuid not null references auth.users(id) on delete restrict,
  physical_check text not null default 'confirmed_present' check (physical_check='confirmed_present'), notification_id uuid references public.club_notification_events(id) on delete restrict,
  idempotency_key text not null, created_at timestamptz not null default now(), unique(organisation_id,idempotency_key),
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  foreign key(demand_id) references public.club_supplier_demand(id) on delete restrict,
  foreign key(order_id,organisation_id) references public.club_orders(id,organisation_id) on delete restrict
);
alter table public.club_collection_reminder_events enable row level security;

create table if not exists public.club_stock_removals (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  location_id uuid not null, product_id uuid not null, quantity integer not null check(quantity>0), reason text not null check(reason in ('staff_consumption','complimentary','promotion_sample','damaged','waste','other')),
  note text, retail_unit_price_minor integer check(retail_unit_price_minor is null or retail_unit_price_minor>=0), cost_unit_minor integer check(cost_unit_minor is null or cost_unit_minor>=0), actor_user_id uuid not null references auth.users(id) on delete restrict,
  authorising_user_id uuid references auth.users(id) on delete set null, idempotency_key text not null, created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key), unique(id,organisation_id),
  foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id) on delete restrict,
  foreign key(product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict
);

create table if not exists public.club_order_discounts (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, order_id uuid not null,
  kind text not null check(kind in ('percentage','fixed','comp')), value_minor integer check(value_minor is null or value_minor>=0), percent numeric check(percent is null or (percent>=0 and percent<=100)), discount_minor integer not null check(discount_minor>=0), reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict, authorising_user_id uuid references auth.users(id) on delete set null, idempotency_key text not null, created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key), unique(order_id), foreign key(order_id,organisation_id) references public.club_orders(id,organisation_id) on delete restrict
);

-- Extend the live finaliser to support an authoritative zero-total customer
-- comp without inventing a payment. Non-zero orders still require paid state.
create or replace function public.club_finalize_paid_order(p_order_id uuid, p_actor_user_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_item public.club_order_items%rowtype; v_product public.club_commerce_products%rowtype; v_customer uuid;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found or (v_order.status<>'paid' and not (v_order.status='pending_payment' and v_order.total_minor=0)) then raise exception 'Paid order is required for finalisation' using errcode='22023'; end if;
  if v_order.status='pending_payment' then update public.club_orders set status='paid',updated_at=now() where id=v_order.id returning * into v_order; end if;
  for v_item in select * from public.club_order_items where order_id=v_order.id order by id loop
    if v_item.stock_tracked then insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,p_actor_user_id,'order-finalise:'||v_item.id::text) on conflict(organisation_id,idempotency_key) do nothing; end if;
    select * into v_product from public.club_commerce_products where id=v_item.product_id and organisation_id=v_order.organisation_id;
    if v_product.service_id is not null then
      if v_order.location_id is null then raise exception 'Service order requires a location' using errcode='22023'; end if;
      v_customer:=v_order.customer_id; if v_customer is null and v_order.user_id is not null then select id into v_customer from public.club_customers where organisation_id=v_order.organisation_id and user_id=v_order.user_id limit 1; end if;
      insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,commerce_order_item_id,metadata) values(v_order.organisation_id,v_order.location_id,v_product.service_id,v_customer,p_actor_user_id,v_item.quantity,v_item.unit_price_minor,v_order.currency,'paid','commerce',v_order.id::text,'pending',v_item.id,jsonb_build_object('commerce_order_id',v_order.id,'comp',v_order.total_minor=0)) on conflict (commerce_order_item_id) do nothing;
    end if;
  end loop;
  perform public.club_create_supplier_demand_for_order(v_order.id);
end; $$;
revoke all on function public.club_finalize_paid_order(uuid,uuid) from public,anon,authenticated;
alter table public.club_stock_removals enable row level security; alter table public.club_order_discounts enable row level security;
revoke all on table public.club_collection_reminder_events,public.club_stock_removals,public.club_order_discounts from public,anon,authenticated;

create or replace function public.club_confirm_supplier_shelf_ready(p_organisation_id uuid,p_demand_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_supplier_demand%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Shelf confirmation is not permitted' using errcode='42501'; end if;
  select * into d from public.club_supplier_demand where id=p_demand_id and organisation_id=p_organisation_id for update;
  if not found or d.status not in ('received','ready_for_collection') or d.quantity_received<d.quantity_required or d.quantity_allocated<d.quantity_required then raise exception 'Customer allocation is not ready for shelf placement' using errcode='22023'; end if;
  update public.club_supplier_demand set status='ready_for_collection',ready_at=coalesce(ready_at,now()),shelf_confirmed_at=coalesce(shelf_confirmed_at,now()),shelf_confirmed_by=coalesce(shelf_confirmed_by,auth.uid()),updated_at=now() where id=d.id returning * into d;
  insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,payload) values(p_organisation_id,d.user_id,'order_ready_for_collection',d.order_id,jsonb_build_object('state','queued','collection_code',d.collection_code)) on conflict(order_id,event_type) do nothing;
  return to_jsonb(d);
end; $$;

-- Allocation records physical receipt/ownership first. Shelf confirmation is a
-- deliberate later step for unstaffed locations and is the only ready transition.
create or replace function public.club_allocate_supplier_units(p_organisation_id uuid,p_receipt_line_id uuid,p_demand_id uuid,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare rl public.club_supplier_receipt_lines%rowtype; d public.club_supplier_demand%rowtype; used integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') or p_quantity<1 then raise exception 'Supplier allocation is not permitted' using errcode='42501'; end if;
  select * into rl from public.club_supplier_receipt_lines where id=p_receipt_line_id for update;
  select * into d from public.club_supplier_demand where id=p_demand_id and organisation_id=p_organisation_id for update;
  if not found or not exists(select 1 from public.club_supplier_order_batch_lines bl join public.club_supplier_receipts r on r.batch_id=bl.batch_id where bl.id=rl.batch_line_id and r.organisation_id=p_organisation_id and bl.supplier_product_id=d.supplier_product_id and d.batch_id=bl.batch_id) then raise exception 'Allocation target is invalid' using errcode='22023'; end if;
  select coalesce(sum(quantity_allocated),0) into used from public.club_supplier_allocations where receipt_line_id=rl.id;
  if used+p_quantity>rl.quantity_received or d.quantity_allocated+p_quantity>d.quantity_required then raise exception 'Allocation exceeds available quantity' using errcode='22023'; end if;
  insert into public.club_supplier_allocations(organisation_id,receipt_line_id,demand_id,quantity_allocated,allocated_by) values(p_organisation_id,rl.id,d.id,p_quantity,auth.uid());
  update public.club_supplier_demand set quantity_allocated=quantity_allocated+p_quantity,quantity_received=quantity_received+p_quantity,updated_at=now() where id=d.id returning * into d;
  if d.quantity_allocated>=d.quantity_required then update public.club_supplier_demand set status='received',updated_at=now() where id=d.id and status not in ('collected','cancelled') returning * into d; end if;
  return to_jsonb(d);
end; $$;

create or replace function public.club_list_collection_shelf_checks(p_organisation_id uuid,p_location_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Shelf checks are not permitted' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'collection_code',d.collection_code,'order_id',d.order_id,'user_id',d.user_id,'location_id',d.collection_location_id,'ready_at',d.ready_at,'days_ready',floor(extract(epoch from(now()-d.ready_at))/86400)::integer) order by d.ready_at), '[]'::jsonb) into result
  from public.club_supplier_demand d where d.organisation_id=p_organisation_id and d.status='ready_for_collection' and d.ready_at<=now()-interval '3 days' and (p_location_id is null or d.collection_location_id=p_location_id);
  return result;
end; $$;

create or replace function public.club_list_collection_shelf_queue(p_organisation_id uuid,p_location_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Shelf queue is not permitted' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'collection_code',x.collection_code,'order_id',x.order_id,'user_id',x.user_id,'location_id',x.location_id,'order_reference',left(x.order_id::text,8),'member_name',coalesce(c.display_name,'Member'),'collection_location',coalesce(l.name,'Collection area'),'items_summary',x.items_summary,'ready_at',x.ready_at,'shelf_confirmed_at',x.shelf_confirmed_at,'status',x.status) order by x.ready_at), '[]'::jsonb) into result
  from (select d.id,d.collection_code,d.order_id,d.user_id,d.collection_location_id as location_id,d.ready_at,d.shelf_confirmed_at,d.status,string_agg(coalesce(cp.name,sp.name)||' × '||d.quantity_required::text,', ' order by sp.name) as items_summary
        from public.club_supplier_demand d join public.club_supplier_products sp on sp.id=d.supplier_product_id left join public.club_commerce_products cp on cp.id=sp.club_product_id
        where d.organisation_id=p_organisation_id and d.status in ('received','ready_for_collection') and d.quantity_received>=d.quantity_required and d.quantity_allocated>=d.quantity_required and (p_location_id is null or d.collection_location_id=p_location_id)
        group by d.id,d.collection_code,d.order_id,d.user_id,d.collection_location_id,d.ready_at,d.shelf_confirmed_at,d.status) x
  left join public.club_customers c on c.organisation_id=p_organisation_id and c.user_id=x.user_id
  left join public.club_locations l on l.id=x.location_id and l.organisation_id=p_organisation_id;
  return result;
end; $$;

create or replace function public.club_scan_collection_shelf_reminder(p_organisation_id uuid,p_collection_code text,p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_supplier_demand%rowtype; n public.club_notification_events%rowtype; recent public.club_collection_reminder_events%rowtype; e public.club_collection_reminder_events%rowtype; key text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.receive') then raise exception 'Collection reminder is not permitted' using errcode='42501'; end if;
  select * into d from public.club_supplier_demand where organisation_id=p_organisation_id and collection_code=btrim(p_collection_code) and collection_location_id=p_location_id for update;
  if not found or d.status<>'ready_for_collection' or d.ready_at>now()-interval '3 days' then raise exception 'Collection shelf reminder is not eligible' using errcode='22023'; end if;
  select * into recent from public.club_collection_reminder_events where organisation_id=p_organisation_id and demand_id=d.id and created_at>=now()-interval '24 hours' order by created_at desc limit 1;
  if found then return jsonb_build_object('demand',to_jsonb(d),'already_recorded',true,'recent_reminder_at',recent.created_at); end if;
  key:=d.collection_code||':'||to_char(current_date,'YYYYMMDD');
  insert into public.club_notification_events(organisation_id,user_id,event_type,order_id,payload) values(p_organisation_id,d.user_id,'collection_shelf_reminder',d.order_id,jsonb_build_object('state','queued','collection_code',d.collection_code,'physical_check','confirmed_present')) returning * into n;
  insert into public.club_collection_reminder_events(organisation_id,location_id,demand_id,order_id,actor_user_id,notification_id,idempotency_key) values(p_organisation_id,d.collection_location_id,d.id,d.order_id,auth.uid(),n.id,key) on conflict(organisation_id,idempotency_key) do nothing returning * into e;
  if e.id is null then return jsonb_build_object('demand',to_jsonb(d),'already_recorded',true); end if;
  return jsonb_build_object('demand',to_jsonb(d),'notification',to_jsonb(n),'reminder',to_jsonb(e));
end; $$;

create or replace function public.club_record_stock_removal(p_organisation_id uuid,p_location_id uuid,p_product_id uuid,p_quantity integer,p_reason text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare product public.club_commerce_products%rowtype; r public.club_stock_removals%rowtype; existing public.club_stock_removals%rowtype; available integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.stock_remove') then raise exception 'Stock removal is not permitted' using errcode='42501'; end if;
  if p_quantity<1 or p_reason not in ('staff_consumption','complimentary','promotion_sample','damaged','waste','other') or nullif(btrim(p_idempotency_key),'') is null then raise exception 'Invalid stock removal' using errcode='22023'; end if;
  select * into existing from public.club_stock_removals where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(existing); end if;
  select * into product from public.club_commerce_products where id=p_product_id and organisation_id=p_organisation_id and active and stock_tracked for share; if not found then raise exception 'Stock product is unavailable' using errcode='P0002'; end if;
  select coalesce(sum(quantity_delta),0) into available from public.club_stock_movements where organisation_id=p_organisation_id and location_id=p_location_id and product_id=p_product_id;
  if available < p_quantity then raise exception 'Insufficient free stock' using errcode='22003'; end if;
  insert into public.club_stock_removals(organisation_id,location_id,product_id,quantity,reason,note,retail_unit_price_minor,cost_unit_minor,actor_user_id,authorising_user_id,idempotency_key) values(p_organisation_id,p_location_id,p_product_id,p_quantity,p_reason,p_note,product.sell_price_minor,product.cost_price_minor,auth.uid(),auth.uid(),p_idempotency_key) returning * into r;
  insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,p_product_id,case when p_reason in ('complimentary','promotion_sample') then 'complimentary' when p_reason in ('damaged','waste') then 'waste' else 'manual_adjustment' end,-p_quantity,'stock_removal:'||p_reason,auth.uid(),'removal:'||r.id::text) on conflict(organisation_id,idempotency_key) do nothing;
  return to_jsonb(r);
end; $$;

create or replace function public.club_apply_order_discount(p_organisation_id uuid,p_order_id uuid,p_kind text,p_value_minor integer,p_percent numeric,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; d public.club_order_discounts%rowtype; existing public.club_order_discounts%rowtype; discount integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') or nullif(btrim(p_reason),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_kind not in ('percentage','fixed','comp') then raise exception 'Discounting is not permitted' using errcode='42501'; end if;
  select * into existing from public.club_order_discounts where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return jsonb_build_object('discount',to_jsonb(existing),'order_id',existing.order_id,'total_minor',(select total_minor from public.club_orders where id=existing.order_id and organisation_id=p_organisation_id)); end if;
  select * into o from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update; if not found or o.status<>'pending_payment' then raise exception 'Order is not discountable' using errcode='22023'; end if;
  if exists(select 1 from public.club_order_discounts where order_id=o.id) then raise exception 'Order already has a discount' using errcode='23505'; end if;
  if p_kind='percentage' and (p_percent is null or p_percent<0 or p_percent>100 or p_value_minor is not null) then raise exception 'Invalid percentage discount' using errcode='22023'; end if;
  if p_kind='fixed' and (p_value_minor is null or p_value_minor<0 or p_percent is not null) then raise exception 'Invalid fixed discount' using errcode='22023'; end if;
  discount:=case when p_kind='percentage' then round(o.subtotal_minor*p_percent/100)::integer when p_kind='fixed' then p_value_minor else o.subtotal_minor end;
  if discount<0 or discount>o.subtotal_minor then raise exception 'Discount exceeds order value' using errcode='22023'; end if;
  insert into public.club_order_discounts(organisation_id,order_id,kind,value_minor,percent,discount_minor,reason,actor_user_id,idempotency_key) values(p_organisation_id,o.id,p_kind,p_value_minor,p_percent,discount,p_reason,auth.uid(),p_idempotency_key) returning * into d;
  update public.club_orders set discount_minor=discount,total_minor=o.subtotal_minor-discount,updated_at=now() where id=o.id;
  if o.subtotal_minor-discount=0 then perform public.club_finalize_paid_order(o.id,auth.uid()); end if;
  return jsonb_build_object('discount',to_jsonb(d),'order_id',o.id,'total_minor',o.subtotal_minor-discount);
end; $$;

revoke all on function public.club_confirm_supplier_shelf_ready(uuid,uuid),public.club_list_collection_shelf_checks(uuid,uuid),public.club_list_collection_shelf_queue(uuid,uuid),public.club_scan_collection_shelf_reminder(uuid,text,uuid),public.club_record_stock_removal(uuid,uuid,uuid,integer,text,text,text),public.club_apply_order_discount(uuid,uuid,text,integer,numeric,text,text) from public,anon;
grant execute on function public.club_confirm_supplier_shelf_ready(uuid,uuid),public.club_list_collection_shelf_checks(uuid,uuid),public.club_list_collection_shelf_queue(uuid,uuid),public.club_scan_collection_shelf_reminder(uuid,text,uuid),public.club_record_stock_removal(uuid,uuid,uuid,integer,text,text,text),public.club_apply_order_discount(uuid,uuid,text,integer,numeric,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-09-30-club-member-import.sql ===
-- Owner-operated ClubManager staging and reconciliation. This migration stores
-- untrusted source evidence and never creates auth users, payment history or
-- access grants during staging.
alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'));
-- Owner/admin import authority is explicit; staff, trainers and members do not
-- receive it through their role presets.
create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select case when auth.uid() is null or p_user_id is distinct from auth.uid() then false when p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then false when exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and m.role='owner' and p_capability='staff.permissions_manage') then true when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='deny') then false when exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=auth.uid() and o.capability=p_capability and o.decision='allow') then true else exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and ((m.role='owner' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage')) or (m.role='gym_admin' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage')) or (m.role='gym_staff' and p_capability in ('members.view','members.create','members.link_account','payments.take','payments.record_cash','cash.reconcile','supplier.receive','commerce.collections_manage')) or (m.role='trainer' and p_capability='members.view'))) end;
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;
create or replace function public.club_save_staff_permission(p_organisation_id uuid,p_user_id uuid,p_capability text,p_decision text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_staff_permission_overrides%rowtype;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Staff permissions require owner access' using errcode='42501'; end if;
 if p_decision not in ('allow','deny') or p_capability not in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage') then raise exception 'Invalid permission' using errcode='22023'; end if;
 if p_capability='staff.permissions_manage' and p_decision='allow' and not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='owner') then raise exception 'Owner capability cannot be granted to non-owner' using errcode='42501'; end if;
 if p_capability='staff.permissions_manage' and p_decision='deny' and p_user_id=auth.uid() then raise exception 'Owner administration cannot be denied' using errcode='42501'; end if;
 if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role in ('gym_staff','gym_admin','owner')) then raise exception 'Operational staff member not found' using errcode='P0002'; end if;
 insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by) values(p_organisation_id,p_user_id,p_capability,p_decision,auth.uid()) on conflict(organisation_id,user_id,capability) do update set decision=excluded.decision,created_by=excluded.created_by,created_at=now() returning * into r;
 return to_jsonb(r);
end; $$;
revoke all on function public.club_save_staff_permission(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_save_staff_permission(uuid,uuid,text,text) to authenticated;
create table if not exists public.club_member_import_batches (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  source_system text not null check(source_system='clubmanager'), original_filename text not null, source_checksum text,
  uploaded_by uuid not null references auth.users(id) on delete restrict, status text not null default 'uploaded' check(status in ('uploaded','mapping_required','validating','review_required','ready','importing','completed','failed','cancelled')),
  headers jsonb not null default '[]'::jsonb check(jsonb_typeof(headers)='array'), mapping jsonb not null default '{}'::jsonb check(jsonb_typeof(mapping)='object'), row_count integer not null default 0 check(row_count>=0), valid_count integer not null default 0 check(valid_count>=0), warning_count integer not null default 0 check(warning_count>=0), blocking_count integer not null default 0 check(blocking_count>=0), imported_count integer not null default 0 check(imported_count>=0), linked_count integer not null default 0 check(linked_count>=0), failed_count integer not null default 0 check(failed_count>=0), created_at timestamptz not null default now(), import_started_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now(), unique(organisation_id,id,source_system), unique(id,organisation_id)
);
create table if not exists public.club_member_import_rows (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, batch_id uuid not null references public.club_member_import_batches(id) on delete cascade, source_row_number integer not null check(source_row_number>1), raw_values jsonb not null check(jsonb_typeof(raw_values)='object'), normalized_values jsonb not null default '{}'::jsonb check(jsonb_typeof(normalized_values)='object'), warnings jsonb not null default '[]'::jsonb check(jsonb_typeof(warnings)='array'), blockers jsonb not null default '[]'::jsonb check(jsonb_typeof(blockers)='array'), action text not null default 'new' check(action in ('new','exact_match','possible_match','invalid','skip')), match_candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(match_candidates)='array'), imported_customer_id uuid, imported_member_id uuid references public.club_members(id) on delete set null, imported_membership_id uuid, outcome text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(batch_id,source_row_number), foreign key(batch_id,organisation_id) references public.club_member_import_batches(id,organisation_id) on delete cascade, foreign key(imported_customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete set null, foreign key(imported_membership_id,organisation_id) references public.club_memberships(id,organisation_id) on delete set null
);
create table if not exists public.club_member_import_package_mappings (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, batch_id uuid not null references public.club_member_import_batches(id) on delete cascade, source_package text not null, club_product_id uuid, status text not null default 'unmapped' check(status in ('unmapped','mapped','manual')), reason text, created_at timestamptz not null default now(), unique(batch_id,source_package), foreign key(club_product_id,organisation_id) references public.club_products(id,organisation_id) on delete restrict
);
create table if not exists public.club_member_import_identities (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, source_system text not null check(source_system='clubmanager'), source_member_reference text not null, customer_id uuid not null, first_seen_batch_id uuid not null references public.club_member_import_batches(id) on delete restrict, created_at timestamptz not null default now(), unique(organisation_id,source_system,source_member_reference), foreign key(customer_id,organisation_id) references public.club_customers(id,organisation_id) on delete restrict
);
alter table public.club_member_import_batches enable row level security; alter table public.club_member_import_rows enable row level security; alter table public.club_member_import_package_mappings enable row level security; alter table public.club_member_import_identities enable row level security;
revoke all on public.club_member_import_batches,public.club_member_import_rows,public.club_member_import_package_mappings,public.club_member_import_identities from public,anon,authenticated;

create or replace function public.club_create_member_import_batch(p_organisation_id uuid,p_filename text,p_checksum text,p_headers jsonb,p_mapping jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; item jsonb; n integer:=0; valid integer:=0; warnings integer:=0; blockers integer:=0; candidate_count integer; candidate_id uuid; row_action text;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 if nullif(btrim(p_filename),'') is null or jsonb_typeof(p_headers)<>'array' or jsonb_typeof(p_mapping)<>'object' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then raise exception 'Invalid member import batch' using errcode='22023'; end if;
 insert into public.club_member_import_batches(organisation_id,source_system,original_filename,source_checksum,uploaded_by,status,headers,mapping) values(p_organisation_id,'clubmanager',left(btrim(p_filename),255),nullif(btrim(p_checksum),''),auth.uid(),'validating',p_headers,p_mapping) returning * into b;
 for item in select value from jsonb_array_elements(p_rows) loop n:=n+1; candidate_count:=0; candidate_id:=null; row_action:=coalesce(item->>'action','new'); if jsonb_typeof(item->'raw')<>'object' then blockers:=blockers+1; insert into public.club_member_import_rows(organisation_id,batch_id,source_row_number,raw_values,blockers,action) values(p_organisation_id,b.id,n+1,'{}'::jsonb,jsonb_build_array('Raw source row is invalid'),'invalid'); else if jsonb_array_length(coalesce(item->'blockers','[]'::jsonb))>0 then blockers:=blockers+1; else if nullif(btrim(item->'normalized'->>'legacyReference'),'') is not null then select customer_id into candidate_id from public.club_member_import_identities where organisation_id=p_organisation_id and source_system='clubmanager' and source_member_reference=btrim(item->'normalized'->>'legacyReference'); if candidate_id is not null then row_action:='exact_match'; candidate_count:=1; end if; end if; if candidate_id is null and nullif(btrim(item->'normalized'->>'email'),'') is not null then select count(*),min(c.id) into candidate_count,candidate_id from public.club_customers c where c.organisation_id=p_organisation_id and lower(c.email)=lower(btrim(item->'normalized'->>'email')); if candidate_count=1 then row_action:='exact_match'; elsif candidate_count>1 then row_action:='possible_match'; blockers:=blockers+1; end if; end if; valid:=valid+1; end if; warnings:=warnings+jsonb_array_length(coalesce(item->'warnings','[]'::jsonb)); insert into public.club_member_import_rows(organisation_id,batch_id,source_row_number,raw_values,normalized_values,warnings,blockers,action,match_candidates,imported_customer_id) values(p_organisation_id,b.id,coalesce((item->>'row_number')::integer,n+1),item->'raw',coalesce(item->'normalized','{}'::jsonb),coalesce(item->'warnings','[]'::jsonb),coalesce(item->'blockers','[]'::jsonb),row_action,case when candidate_id is null then '[]'::jsonb else jsonb_build_array(candidate_id) end,candidate_id); end if; end loop;
 update public.club_member_import_batches set row_count=n,valid_count=valid,warning_count=warnings,blocking_count=blockers,status=case when blockers>0 then 'review_required' else 'ready' end,updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.batch_created','member_import_batch',b.id,jsonb_build_object('source_system','clubmanager','row_count',n,'blocking_count',blockers));
 return to_jsonb(b);
end; $$;

create or replace function public.club_list_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('batch',to_jsonb(b),'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.source_row_number) from public.club_member_import_rows r where r.batch_id=b.id and r.organisation_id=p_organisation_id),'[]'::jsonb),'package_mappings',coalesce((select jsonb_agg(to_jsonb(m) order by m.source_package) from public.club_member_import_package_mappings m where m.batch_id=b.id and m.organisation_id=p_organisation_id),'[]'::jsonb)) from public.club_member_import_batches b where b.id=p_batch_id and b.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import');
$$;

create or replace function public.club_map_member_import_package(p_organisation_id uuid,p_batch_id uuid,p_source_package text,p_club_product_id uuid,p_status text default 'mapped')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_member_import_package_mappings%rowtype;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 if nullif(btrim(p_source_package),'') is null or p_status not in ('mapped','manual') or not exists(select 1 from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id) then raise exception 'Invalid package mapping' using errcode='22023'; end if;
 if p_status='mapped' and not exists(select 1 from public.club_products where id=p_club_product_id and organisation_id=p_organisation_id and kind='membership' and archived_at is null) then raise exception 'Membership package is not available' using errcode='22023'; end if;
 insert into public.club_member_import_package_mappings(organisation_id,batch_id,source_package,club_product_id,status) values(p_organisation_id,p_batch_id,btrim(p_source_package),p_club_product_id,p_status) on conflict(batch_id,source_package) do update set club_product_id=excluded.club_product_id,status=excluded.status returning * into r;
 return to_jsonb(r);
end; $$;

create or replace function public.club_confirm_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found or b.blocking_count>0 or exists(select 1 from public.club_member_import_rows r where r.batch_id=b.id and r.organisation_id=p_organisation_id and nullif(btrim(r.normalized_values->>'membershipName'),'') is not null and not exists(select 1 from public.club_member_import_package_mappings m where m.batch_id=b.id and m.organisation_id=p_organisation_id and lower(m.source_package)=lower(btrim(r.normalized_values->>'membershipName')) and m.status in ('mapped','manual'))) then raise exception 'Resolve blocking import issues first' using errcode='22023'; end if;
 update public.club_member_import_batches set status='ready',updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.authorised','member_import_batch',b.id,jsonb_build_object('row_count',b.row_count));
 return to_jsonb(b);
end; $$;

-- Execution is deliberately customer-first: imported people without an R12
-- account are retained as customers; memberships remain reviewable until an
-- account/package is explicitly linked. No auth users, payments or access are created.
create or replace function public.club_execute_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; customer public.club_customers%rowtype; ref text; created integer:=0; linked integer:=0;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found or b.status not in ('ready','importing') or b.blocking_count>0 then raise exception 'Batch is not ready to import' using errcode='22023'; end if;
 update public.club_member_import_batches set status='importing',import_started_at=coalesce(import_started_at,now()),updated_at=now() where id=b.id;
 for r in select * from public.club_member_import_rows where batch_id=b.id and organisation_id=p_organisation_id and action<>'skip' and imported_customer_id is null order by source_row_number for update loop
   ref:=nullif(btrim(r.normalized_values->>'legacyReference'),'');
   if ref is not null then select customer_id into customer.id from public.club_member_import_identities where organisation_id=p_organisation_id and source_system='clubmanager' and source_member_reference=ref; end if;
   if customer.id is null then insert into public.club_customers(organisation_id,display_name,email,phone,status) values(p_organisation_id,coalesce(nullif(btrim(r.normalized_values->>'fullName'),''),concat_ws(' ',nullif(btrim(r.normalized_values->>'firstName'),''),nullif(btrim(r.normalized_values->>'lastName'),'')),'Imported member'),nullif(btrim(r.normalized_values->>'email'),''),nullif(btrim(r.normalized_values->>'phone'),''),'member') returning * into customer; created:=created+1; if ref is not null then insert into public.club_member_import_identities(organisation_id,source_system,source_member_reference,customer_id,first_seen_batch_id) values(p_organisation_id,'clubmanager',ref,customer.id,b.id) on conflict do nothing; end if; else linked:=linked+1; end if;
   update public.club_member_import_rows set imported_customer_id=customer.id,outcome='customer_staged',updated_at=now() where id=r.id;
   customer.id:=null;
 end loop;
 update public.club_member_import_rows set outcome='linked_existing',updated_at=now() where batch_id=b.id and organisation_id=p_organisation_id and imported_customer_id is not null and outcome is null;
 select count(*) into linked from public.club_member_import_rows where batch_id=b.id and organisation_id=p_organisation_id and outcome='linked_existing';
 update public.club_member_import_batches set status='completed',completed_at=now(),imported_count=created,linked_count=linked,updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.completed','member_import_batch',b.id,jsonb_build_object('created',created,'linked',linked));
 return to_jsonb(b);
end; $$;

revoke all on function public.club_create_member_import_batch(uuid,text,text,jsonb,jsonb,jsonb),public.club_list_member_import_batch(uuid,uuid),public.club_map_member_import_package(uuid,uuid,text,uuid,text),public.club_confirm_member_import_batch(uuid,uuid),public.club_execute_member_import_batch(uuid,uuid) from public,anon;
grant execute on function public.club_create_member_import_batch(uuid,text,text,jsonb,jsonb,jsonb),public.club_list_member_import_batch(uuid,uuid),public.club_map_member_import_package(uuid,uuid,text,uuid,text),public.club_confirm_member_import_batch(uuid,uuid),public.club_execute_member_import_batch(uuid,uuid) to authenticated;

-- Revalidation is deliberately derived from raw_values and the persisted mapping;
-- browser-supplied diagnostics are retained as evidence but never determine readiness.
create or replace function public.club_revalidate_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; raw jsonb; m jsonb; norm jsonb; blocks jsonb; warns jsonb; ident text; ref text; seen_idents text[]:='{}'; seen_refs text[]:='{}'; date_format text; date_values text[]; v_valid integer; v_warning_count integer; v_blocking integer;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found then raise exception 'Import batch not found' using errcode='P0002'; end if;
 m:=b.mapping; date_format:=nullif(m->>'date_format','');
 for r in select * from public.club_member_import_rows where batch_id=b.id and organisation_id=p_organisation_id order by source_row_number for update loop
   raw:=r.raw_values; blocks:='[]'::jsonb; warns:='[]'::jsonb;
   norm:=jsonb_build_object(
     'firstName',nullif(btrim(coalesce(raw->>(m->>'firstName'),raw->>'first_name',raw->>'firstname')),''),
     'lastName',nullif(btrim(coalesce(raw->>(m->>'lastName'),raw->>'last_name',raw->>'surname')),''),
     'fullName',nullif(btrim(coalesce(raw->>(m->>'fullName'),raw->>'full_name',raw->>'name')),''),
     'email',lower(nullif(btrim(coalesce(raw->>(m->>'email'),raw->>'email')),'')),
     'phone',nullif(regexp_replace(coalesce(raw->>(m->>'phone'),raw->>'mobile',raw->>'phone'),'[^0-9+]','','g'),''),
     'legacyReference',nullif(btrim(coalesce(raw->>(m->>'legacyReference'),raw->>'legacy_member_reference',raw->>'member_id',raw->>'member id',raw->>'id')),''),
     'membershipName',nullif(btrim(coalesce(raw->>(m->>'membershipName'),raw->>'membership_type',raw->>'membership',raw->>'package')),''),
     'membershipStatus',nullif(btrim(coalesce(raw->>(m->>'membershipStatus'),raw->>'membership_status',raw->>'status')),''),
     'startDate',nullif(btrim(coalesce(raw->>(m->>'startDate'),raw->>'start_date',raw->>'join_date')),''),
     'nextPaymentDate',nullif(btrim(coalesce(raw->>(m->>'nextPaymentDate'),raw->>'next_payment_date')),''),
     'endDate',nullif(btrim(coalesce(raw->>(m->>'endDate'),raw->>'end_date',raw->>'expiry_date')),''),
     'homeLocation',nullif(btrim(coalesce(raw->>(m->>'homeLocation'),raw->>'home_gym',raw->>'home_location')),''),
     'billingMethod',nullif(btrim(coalesce(raw->>(m->>'billingMethod'),raw->>'payment_method',raw->>'billing_method')),'')
   );
   if coalesce(norm->>'firstName','')='' and coalesce(norm->>'lastName','')='' and coalesce(norm->>'fullName','')='' and coalesce(norm->>'email','')='' and coalesce(norm->>'phone','')='' and coalesce(norm->>'legacyReference','')='' then blocks:=blocks||jsonb_build_array('A name, email, phone or ClubManager reference is required'); end if;
   ref:=nullif(norm->>'legacyReference',''); ident:=coalesce(ref,'email:'||nullif(norm->>'email',''),'phone:'||nullif(norm->>'phone',''),'name:'||lower(nullif(norm->>'fullName','')));
   if ref is not null and ref=any(seen_refs) then blocks:=blocks||jsonb_build_array('Duplicate source external ID in this batch'); elsif ref is not null then seen_refs:=array_append(seen_refs,ref); end if;
   if ident is not null and ident=any(seen_idents) then blocks:=blocks||jsonb_build_array('Duplicate source person in this batch'); elsif ident is not null then seen_idents:=array_append(seen_idents,ident); end if;
   if norm->>'email' is not null and (select count(*) from public.club_customers c where c.organisation_id=p_organisation_id and lower(c.email)=norm->>'email')>1 then blocks:=blocks||jsonb_build_array('Multiple existing customers match this email'); end if;
   date_values:=ARRAY[norm->>'startDate',norm->>'nextPaymentDate',norm->>'endDate'];
   foreach ident in ARRAY date_values loop
     if ident is not null and ident<>'' then
       if ident like '%/%' and date_format is null then blocks:=blocks||jsonb_build_array('Date format requires confirmation');
       elsif ident like '%/%' and date_format not in ('DD/MM/YYYY','MM/DD/YYYY') then blocks:=blocks||jsonb_build_array('Unsupported date format');
       elsif ident !~ '^\d{4}-\d{2}-\d{2}$' and ident not like '%/%' then blocks:=blocks||jsonb_build_array('Invalid date value'); end if;
     end if;
   end loop;
   if norm->>'billingMethod' ilike '%gocardless%' then warns:=warns||jsonb_build_array('GoCardless reference requires provider reconciliation'); end if;
   if norm->>'email' is null then warns:=warns||jsonb_build_array('Email is missing'); end if;
   if norm->>'phone' is null then warns:=warns||jsonb_build_array('Phone is missing'); end if;
   if norm->>'membershipName' is null then warns:=warns||jsonb_build_array('Membership package is missing');
   elsif not exists(select 1 from public.club_member_import_package_mappings pm where pm.batch_id=b.id and pm.organisation_id=p_organisation_id and lower(pm.source_package)=lower(norm->>'membershipName') and pm.status in ('mapped','manual')) then blocks:=blocks||jsonb_build_array('Membership package mapping required'); end if;
   update public.club_member_import_rows set normalized_values=norm,warnings=warns,blockers=blocks,action=case when jsonb_array_length(blocks)>0 then 'invalid' else case when ref is not null and exists(select 1 from public.club_member_import_identities i where i.organisation_id=p_organisation_id and i.source_system='clubmanager' and i.source_member_reference=ref) then 'exact_match' else 'new' end end,updated_at=now() where id=r.id;
 end loop;
 select count(*) filter (where jsonb_array_length(blockers)=0),coalesce(sum(jsonb_array_length(warnings)),0),count(*) filter (where jsonb_array_length(blockers)>0) into v_valid,v_warning_count,v_blocking from public.club_member_import_rows where batch_id=b.id and organisation_id=p_organisation_id;
 update public.club_member_import_batches set row_count=(select count(*) from public.club_member_import_rows where batch_id=b.id and organisation_id=p_organisation_id),valid_count=v_valid,warning_count=v_warning_count,blocking_count=v_blocking,status=case when v_blocking>0 then 'review_required' else 'ready' end,updated_at=now() where id=b.id returning * into b;
 return to_jsonb(b);
end; $$;
revoke all on function public.club_revalidate_member_import_batch(uuid,uuid) from public,anon; grant execute on function public.club_revalidate_member_import_batch(uuid,uuid) to authenticated;

create or replace function public.club_create_member_import_batch(p_organisation_id uuid,p_filename text,p_checksum text,p_headers jsonb,p_mapping jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; item jsonb; n integer:=0;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 if nullif(btrim(p_filename),'') is null or jsonb_typeof(p_headers)<>'array' or jsonb_typeof(p_mapping)<>'object' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then raise exception 'Invalid member import batch' using errcode='22023'; end if;
 insert into public.club_member_import_batches(organisation_id,source_system,original_filename,source_checksum,uploaded_by,status,headers,mapping) values(p_organisation_id,'clubmanager',left(btrim(p_filename),255),nullif(btrim(p_checksum),''),auth.uid(),'validating',p_headers,p_mapping) returning * into b;
 for item in select value from jsonb_array_elements(p_rows) loop n:=n+1; insert into public.club_member_import_rows(organisation_id,batch_id,source_row_number,raw_values,normalized_values,warnings,blockers,action,match_candidates) values(p_organisation_id,b.id,coalesce((item->>'row_number')::integer,n+1),coalesce(item->'raw','{}'::jsonb),'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'new','[]'::jsonb); end loop;
 perform public.club_revalidate_member_import_batch(p_organisation_id,b.id);
 select * into b from public.club_member_import_batches where id=b.id;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.batch_created','member_import_batch',b.id,jsonb_build_object('source_system','clubmanager','row_count',b.row_count,'blocking_count',b.blocking_count));
 return to_jsonb(b);
end; $$;

create or replace function public.club_map_member_import_package(p_organisation_id uuid,p_batch_id uuid,p_source_package text,p_club_product_id uuid,p_status text default 'mapped')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_member_import_package_mappings%rowtype;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 if nullif(btrim(p_source_package),'') is null or p_status not in ('mapped','manual') or not exists(select 1 from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id) then raise exception 'Invalid package mapping' using errcode='22023'; end if;
 if p_status='mapped' and not exists(select 1 from public.club_products where id=p_club_product_id and organisation_id=p_organisation_id and kind='membership' and archived_at is null) then raise exception 'Membership package is not available' using errcode='22023'; end if;
 insert into public.club_member_import_package_mappings(organisation_id,batch_id,source_package,club_product_id,status) values(p_organisation_id,p_batch_id,btrim(p_source_package),p_club_product_id,p_status) on conflict(batch_id,source_package) do update set club_product_id=excluded.club_product_id,status=excluded.status returning * into r;
 perform public.club_revalidate_member_import_batch(p_organisation_id,p_batch_id);
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.package_mapped','member_import_batch',p_batch_id,jsonb_build_object('source_package',p_source_package,'status',p_status));
 return to_jsonb(r);
end; $$;

create or replace function public.club_confirm_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 perform public.club_revalidate_member_import_batch(p_organisation_id,p_batch_id);
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found or b.blocking_count>0 then raise exception 'Resolve blocking import issues first' using errcode='22023'; end if;
 update public.club_member_import_batches set status='ready',updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.authorised','member_import_batch',b.id,jsonb_build_object('row_count',b.row_count));
 return to_jsonb(b);
end; $$;

create or replace function public.club_execute_member_import_batch(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.club_member_import_batches%rowtype; r record; customer public.club_customers%rowtype; ref text; created integer:=0; linked integer:=0; was_linked boolean;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.import') then raise exception 'Member import is not permitted' using errcode='42501'; end if;
 perform public.club_revalidate_member_import_batch(p_organisation_id,p_batch_id);
 select * into b from public.club_member_import_batches where id=p_batch_id and organisation_id=p_organisation_id for update;
 if not found or b.status<>'ready' or b.blocking_count>0 then raise exception 'Batch is not ready to import' using errcode='22023'; end if;
 update public.club_member_import_batches set status='importing',import_started_at=coalesce(import_started_at,now()),updated_at=now() where id=b.id;
 for r in select * from public.club_member_import_rows where batch_id=b.id and organisation_id=p_organisation_id and action<>'skip' and imported_customer_id is null order by source_row_number for update loop
   customer:=null; ref:=nullif(r.normalized_values->>'legacyReference','');
   if ref is not null then select customer_id into customer.id from public.club_member_import_identities where organisation_id=p_organisation_id and source_system='clubmanager' and source_member_reference=ref; end if;
   was_linked:=false;
   if customer.id is null and r.normalized_values->>'email' is not null then select * into customer from public.club_customers where organisation_id=p_organisation_id and lower(email)=r.normalized_values->>'email' limit 1; end if;
   if customer.id is null then insert into public.club_customers(organisation_id,display_name,email,phone,status) values(p_organisation_id,coalesce(nullif(btrim(r.normalized_values->>'fullName'),''),concat_ws(' ',nullif(btrim(r.normalized_values->>'firstName'),''),nullif(btrim(r.normalized_values->>'lastName'),'')),'Imported member'),nullif(r.normalized_values->>'email',''),nullif(r.normalized_values->>'phone',''),'member') returning * into customer; created:=created+1; else linked:=linked+1; was_linked:=true; end if;
   if ref is not null then insert into public.club_member_import_identities(organisation_id,source_system,source_member_reference,customer_id,first_seen_batch_id) values(p_organisation_id,'clubmanager',ref,customer.id,b.id) on conflict do nothing; end if;
   update public.club_member_import_rows set imported_customer_id=customer.id,outcome=case when was_linked then 'linked_existing' else 'customer_staged' end,updated_at=now() where id=r.id;
 end loop;
 update public.club_member_import_batches set status='completed',completed_at=now(),imported_count=created,linked_count=linked,updated_at=now() where id=b.id returning * into b;
 insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata) values(p_organisation_id,auth.uid(),'member_import.completed','member_import_batch',b.id,jsonb_build_object('created',created,'linked',linked));
 return to_jsonb(b);
end; $$;
revoke all on function public.club_create_member_import_batch(uuid,text,text,jsonb,jsonb,jsonb),public.club_map_member_import_package(uuid,uuid,text,uuid,text),public.club_confirm_member_import_batch(uuid,uuid),public.club_execute_member_import_batch(uuid,uuid) from public,anon;
grant execute on function public.club_create_member_import_batch(uuid,text,text,jsonb,jsonb,jsonb),public.club_map_member_import_package(uuid,uuid,text,uuid,text),public.club_confirm_member_import_batch(uuid,uuid),public.club_execute_member_import_batch(uuid,uuid) to authenticated;
-- Keep the operational induction permission distinct from policy administration.
alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage'));
create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
select auth.uid() is not null and p_user_id=auth.uid()
and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage','induction.manage_policy','induction.perform','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage')
and not exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='deny')
and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active and (m.role in ('owner','gym_admin') or (m.role in ('gym_staff','trainer') and p_capability in ('members.view','members.create','members.link_account','memberships.assign','payments.take','payments.record_cash','induction.perform','classes.manage','services.manage','supplier.receive','commerce.collections_manage')) or exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='allow')));
$$;


-- === APPLY supabase/migrations/2026-10-01-club-promotions-engine.sql ===
-- R12 Promotions Engine: durable configuration, historical evidence and Golden Ticket concurrency.
-- REQUIRED for authoritative bundle pricing/order totals. Review/install manually;
-- this migration seeds no offers and makes no provider calls.

create table if not exists public.club_promotion_applied_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  order_id uuid not null references public.club_orders(id) on delete cascade,
  promotion_id uuid not null references public.club_promotions(id) on delete restrict,
  promotion_name text not null,
  gross_minor integer not null check (gross_minor >= 0),
  saving_minor integer not null check (saving_minor >= 0),
  net_minor integer not null check (net_minor >= 0),
  applied_snapshot jsonb not null default '{}' check (jsonb_typeof(applied_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (organisation_id, order_id, promotion_id)
);
create index if not exists club_promotion_applied_orders_order_idx on public.club_promotion_applied_orders(organisation_id, order_id);

create table if not exists public.club_golden_ticket_redemptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  promotion_id uuid not null references public.club_promotions(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  customer_id uuid,
  calendar_month date not null,
  order_id uuid not null references public.club_orders(id) on delete restrict,
  candidate_snapshot jsonb not null check (jsonb_typeof(candidate_snapshot) = 'object'),
  saving_minor integer not null check (saving_minor > 0),
  consumed_at timestamptz not null default now(),
  unique (organisation_id, promotion_id, user_id, calendar_month),
  unique (organisation_id, promotion_id, customer_id, calendar_month)
);
create index if not exists club_golden_ticket_redemptions_order_idx on public.club_golden_ticket_redemptions(organisation_id, order_id);

alter table public.club_promotion_applied_orders enable row level security;
alter table public.club_golden_ticket_redemptions enable row level security;
revoke all on table public.club_promotion_applied_orders, public.club_golden_ticket_redemptions from public, anon, authenticated;
grant select on table public.club_promotion_applied_orders, public.club_golden_ticket_redemptions to authenticated;
drop policy if exists club_promotion_applied_orders_staff on public.club_promotion_applied_orders;
create policy club_promotion_applied_orders_staff on public.club_promotion_applied_orders for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
drop policy if exists club_golden_ticket_redemptions_staff on public.club_golden_ticket_redemptions;
create policy club_golden_ticket_redemptions_staff on public.club_golden_ticket_redemptions for select to authenticated using (public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or user_id=auth.uid());

-- Lifecycle is configuration plus time; a future-dated row is never economically active.
create or replace function public.club_promotion_lifecycle(p_status text, p_starts_at timestamptz, p_ends_at timestamptz, p_now timestamptz default now())
returns text language sql immutable as $$
  select case when p_status in ('paused','expired','draft') then p_status
    when p_ends_at is not null and p_now >= p_ends_at then 'expired'
    when p_now < p_starts_at then 'scheduled'
    else 'active' end
$$;

-- Authoritative promotion evaluation for checkout. Inputs are intent only; product prices are read from canonical catalogue rows.
create or replace function public.club_evaluate_commerce_promotions(p_organisation_id uuid, p_location_id uuid, p_user_id uuid, p_customer_id uuid, p_items jsonb, p_payment_method text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item jsonb; v_product public.club_commerce_products%rowtype; v_gross integer:=0; v_discount integer:=0; v_effect public.club_promotion_effects%rowtype; v_p public.club_promotions%rowtype; v_line integer; v_applied jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Promotion evaluation is not permitted' using errcode='42501'; end if;
  if p_user_id is not null and p_user_id is distinct from auth.uid() and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]')) <> 'array' then raise exception 'Invalid basket' using errcode='22023'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id and active;
    if not found or coalesce((v_item->>'quantity')::integer,0) <= 0 then raise exception 'Product is not sellable' using errcode='22023'; end if;
    v_line := v_product.sell_price_minor * (v_item->>'quantity')::integer; v_gross := v_gross + v_line;
  end loop;
  for v_p in
    select p.*
    from public.club_promotions p
    where p.organisation_id = p_organisation_id
      and p.status = 'active'
      and now() >= p.starts_at
      and (p.ends_at is null or now() < p.ends_at)
      and (cardinality(p.location_ids) = 0 or p_location_id = any(p.location_ids))
      and (
        not exists (select 1 from public.club_promotion_targets t where t.promotion_id = p.id)
        or exists (
          select 1
          from public.club_promotion_targets t
          where t.promotion_id = p.id
            and (
              t.target_type = 'all_commerce'
              or exists (
                select 1 from jsonb_array_elements(p_items) bi
                where t.target_type = 'commerce_product'
                  and t.commerce_product_id = (bi->>'product_id')::uuid
              )
              or exists (
                select 1
                from jsonb_array_elements(p_items) bi
                join public.club_commerce_products cp
                  on cp.id = (bi->>'product_id')::uuid
                 and cp.organisation_id = p_organisation_id
                where t.target_type = 'commerce_category'
                  and cp.category = t.category_key
              )
            )
        )
      )
    order by coalesce((p.eligibility->>'priority')::integer, 0) desc, p.id
  loop
    select * into v_effect from public.club_promotion_effects where promotion_id=v_p.id order by id limit 1;
    if v_effect.effect_type='percentage_discount' then v_line := floor(v_gross * v_effect.percentage_basis_points / 10000); elsif v_effect.effect_type='fixed_discount' then v_line := v_effect.amount_minor; elsif v_effect.effect_type='waive_charge' then v_line := 0; else v_line := 0; end if;
    v_line := least(v_gross, greatest(0, coalesce(v_line,0))); if v_line > v_discount then v_discount := v_line; v_applied := jsonb_build_array(jsonb_build_object('promotion_id',v_p.id,'promotion_name',v_p.name,'saving_minor',v_line,'effect_type',v_effect.effect_type)); end if;
  end loop;
  return jsonb_build_object('gross_minor',v_gross,'discount_minor',v_discount,'total_minor',greatest(0,v_gross-v_discount),'applied',v_applied,'payment_method',p_payment_method);
end; $$;
revoke all on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

-- Corrected allocator: each instance is attempted against a copy of remaining;
-- failed partial attempts are discarded, so leftovers are never consumed.
create or replace function public.club_resolve_promotion_bundles(p_organisation_id uuid,p_items jsonb,p_groups jsonb,p_bundle_price_minor integer,p_repeatable boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare remaining jsonb:='[]'::jsonb; trial jsonb; grp jsonb; item jsonb; components jsonb; instances jsonb:='[]'::jsonb; need integer; take integer; qty integer; original integer; idx integer; made integer:=0; ok boolean; prod public.club_commerce_products%rowtype;
begin
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]')) order by value->>'product_id' loop select * into prod from public.club_commerce_products where id=(item->>'product_id')::uuid and organisation_id=p_organisation_id and active; if not found then raise exception 'Bundle product is unavailable' using errcode='22023'; end if; remaining:=remaining||jsonb_build_array(jsonb_build_object('product_id',prod.id,'category',prod.category,'quantity',(item->>'quantity')::integer,'unit_price_minor',prod.sell_price_minor)); end loop;
  loop
    trial:=remaining; components:='[]'::jsonb; ok:=true; idx:=0;
    while idx<jsonb_array_length(coalesce(p_groups,'[]')) loop grp:=p_groups->idx; need:=coalesce((grp->>'required_quantity')::integer,0); for item in select value from jsonb_array_elements(trial) order by value->>'product_id' loop exit when need=0; qty:=coalesce((item->>'quantity')::integer,0); if qty>0 and (grp->'product_ids' is null or (grp->'product_ids') ? (item->>'product_id')) and (grp->'categories' is null or (grp->'categories') ? coalesce(item->>'category','')) then take:=least(need,qty); components:=components||jsonb_build_array(jsonb_build_object('group_id',coalesce(grp->>'group_id',idx::text),'group_order',idx,'product_id',item->>'product_id','category',item->>'category','quantity',take,'unit_price_minor',(item->>'unit_price_minor')::integer,'original_minor',take*(item->>'unit_price_minor')::integer)); trial:=coalesce((select jsonb_agg(case when value->>'product_id'=item->>'product_id' then jsonb_set(value,'{quantity}',to_jsonb(qty-take)) else value end order by value->>'product_id') from jsonb_array_elements(trial)),'[]'::jsonb); need:=need-take; end if; end loop; if need>0 then ok:=false; exit; end if; idx:=idx+1; end loop;
    if not ok then exit; end if; remaining:=trial; original:=coalesce((select sum((value->>'original_minor')::integer) from jsonb_array_elements(components)),0); made:=made+1; instances:=instances||jsonb_build_array(jsonb_build_object('bundle_instance',made,'original_minor',original,'bundle_price_minor',p_bundle_price_minor,'saving_minor',greatest(0,original-p_bundle_price_minor),'components',components)); if not p_repeatable then exit; end if;
  end loop;
  return jsonb_build_object('bundle_count',made,'instances',instances,'remaining',remaining);
end; $$;
revoke all on function public.club_resolve_promotion_bundles(uuid,jsonb,jsonb,integer,boolean) from public,anon,authenticated;
create or replace function public.club_promotion_eligible_components(p_organisation_id uuid,p_promotion_id uuid,p_items jsonb)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id',cp.id,'quantity',(i->>'quantity')::integer,'unit_price_minor',cp.sell_price_minor,'original_minor',cp.sell_price_minor*(i->>'quantity')::integer) order by cp.id),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i join public.club_commerce_products cp on cp.id=(i->>'product_id')::uuid and cp.organisation_id=p_organisation_id
  where not exists(select 1 from public.club_promotion_targets t where t.promotion_id=p_promotion_id)
     or exists(select 1 from public.club_promotion_targets t where t.promotion_id=p_promotion_id and (t.target_type='all_commerce' or (t.target_type='commerce_product' and t.commerce_product_id=cp.id) or (t.target_type='commerce_category' and t.category_key=cp.category)));
$$;
revoke all on function public.club_promotion_eligible_components(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function public.club_apply_promotion_stack(p_candidates jsonb,p_items jsonb,p_gross_minor integer)
returns jsonb language plpgsql immutable as $$
declare c jsonb; comp jsonb; out jsonb:='[]'::jsonb; consumed jsonb:='{}'::jsonb; net_state jsonb:='{}'::jsonb; selected jsonb; allocated jsonb; mode text; base integer; saving integer; qty integer; used integer; avail integer; pid text; unit integer; item_qty integer; comp_base integer; alloc integer; alloc_sum integer; idx integer; component_count integer; overlap boolean;
begin
  /* Build per-product working state from canonical basket evidence.  Exclusive
     promotions consume quantities; combinable promotions reduce only the
     targeted product's remaining net value (never the whole basket). */
  for comp in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    pid:=comp->>'product_id'; item_qty:=coalesce((comp->>'quantity')::integer,0); unit:=coalesce((comp->>'unit_price_minor')::integer,0);
    net_state:=jsonb_set(net_state,array[pid],to_jsonb(item_qty*unit),true);
  end loop;
  for c in select value from jsonb_array_elements(coalesce(p_candidates,'[]')) order by coalesce((value->>'priority')::integer,0) desc, coalesce((value->>'saving_minor')::integer,0) desc, value->>'promotion_id' loop
    mode:=coalesce(c->>'stacking','exclusive'); overlap:=false; selected:='[]'::jsonb; base:=0;
    for comp in select value from jsonb_array_elements(coalesce(c->'eligible_components', '[]'::jsonb)) loop
      pid:=comp->>'product_id'; qty:=greatest(0,coalesce((comp->>'quantity')::integer,0)); used:=coalesce((consumed->>pid)::integer,0);
      item_qty:=coalesce((select (value->>'quantity')::integer from jsonb_array_elements(p_items) where value->>'product_id'=pid limit 1),0);
      avail:=greatest(0,item_qty-used);
      if mode<>'combinable' and avail=0 and qty>0 then overlap:=true; end if;
      qty:=case when mode='combinable' then least(qty,item_qty) else least(qty,avail) end;
      if qty>0 then
        unit:=coalesce((comp->>'unit_price_minor')::integer,0); comp_base:=case when mode='combinable' then floor(coalesce((net_state->>pid)::numeric,0)*qty/greatest(item_qty,1))::integer else unit*qty end;
        base:=base+comp_base; selected:=selected||jsonb_build_array(comp||jsonb_build_object('quantity',qty,'original_minor',comp_base,'input_net_minor',comp_base));
      end if;
    end loop;
    if overlap or base<=0 then continue; end if;
    saving:=case when c->>'effect_type'='percentage' and coalesce((c->>'base_minor')::integer,0)>0
      then floor(base::numeric * greatest(0,(c->>'saving_minor')::integer) / (c->>'base_minor')::integer)::integer
      else greatest(0,coalesce((c->>'saving_minor')::integer,0)) end;
    saving:=least(base,saving); if saving<=0 then continue; end if;
    allocated:='[]'::jsonb; alloc_sum:=0; idx:=0; component_count:=jsonb_array_length(selected);
    for comp in select value from jsonb_array_elements(selected) loop
      idx:=idx+1; comp_base:=coalesce((comp->>'input_net_minor')::integer,0);
      if idx=component_count then alloc:=greatest(0,saving-alloc_sum); else alloc:=least(comp_base,floor(saving::numeric*comp_base/greatest(base,1))::integer); end if;
      alloc:=least(comp_base,alloc); alloc_sum:=alloc_sum+alloc;
      allocated:=allocated||jsonb_build_array(comp||jsonb_build_object('allocated_saving_minor',alloc,'output_net_minor',greatest(0,comp_base-alloc)));
      pid:=comp->>'product_id'; qty:=coalesce((comp->>'quantity')::integer,0);
      if mode<>'combinable' then consumed:=jsonb_set(consumed,array[pid],to_jsonb(coalesce((consumed->>pid)::integer,0)+qty),true); end if;
      net_state:=jsonb_set(net_state,array[pid],to_jsonb(greatest(0,coalesce((net_state->>pid)::integer,0)-alloc)),true);
    end loop;
    if alloc_sum<saving then
      for idx in 0..component_count-1 loop
        comp:=allocated->idx; comp_base:=coalesce((comp->>'input_net_minor')::integer,0); alloc:=coalesce((comp->>'allocated_saving_minor')::integer,0);
        qty:=least(comp_base-alloc,saving-alloc_sum); if qty>0 then allocated:=jsonb_set(allocated,array[idx::text,'allocated_saving_minor'],to_jsonb(alloc+qty),false); allocated:=jsonb_set(allocated,array[idx::text,'output_net_minor'],to_jsonb(comp_base-alloc-qty),false); pid:=comp->>'product_id'; net_state:=jsonb_set(net_state,array[pid],to_jsonb(greatest(0,coalesce((net_state->>pid)::integer,0)-qty)),true); alloc_sum:=alloc_sum+qty; end if;
        exit when alloc_sum=saving;
      end loop;
    end if;
    out:=out||jsonb_build_array(c||jsonb_build_object('eligible_components',allocated,'input_eligible_base_minor',base,'applied_saving_minor',saving,'output_eligible_base_minor',base-saving));
  end loop; return out;
end; $$;
revoke all on function public.club_apply_promotion_stack(jsonb,jsonb,integer) from public,anon,authenticated;

-- Golden Ticket consumption is intentionally callable only by trusted finalisation code (service role).
create or replace function public.club_consume_golden_ticket(p_organisation_id uuid,p_promotion_id uuid,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_candidate jsonb,p_saving_minor integer,p_calendar_month date default date_trunc('month',now())::date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_golden_ticket_redemptions%rowtype;
begin
  if auth.uid() is not null then raise exception 'Trusted finalisation required' using errcode='42501'; end if;
  if p_saving_minor <= 0 or p_candidate is null or p_order_id is null then raise exception 'Invalid Golden Ticket redemption' using errcode='22023'; end if;
  if not exists(select 1 from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and status in ('paid','fulfilled') and total_minor >= 0) then raise exception 'Order is not complete' using errcode='22023'; end if;
  insert into public.club_golden_ticket_redemptions(organisation_id,promotion_id,user_id,customer_id,calendar_month,order_id,candidate_snapshot,saving_minor) values(p_organisation_id,p_promotion_id,p_user_id,p_customer_id,p_calendar_month,p_order_id,p_candidate,p_saving_minor) on conflict do nothing returning * into v_row;
  if not found then select * into v_row from public.club_golden_ticket_redemptions where organisation_id=p_organisation_id and promotion_id=p_promotion_id and calendar_month=p_calendar_month and ((p_user_id is not null and user_id=p_user_id) or (p_customer_id is not null and customer_id=p_customer_id)) limit 1; end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_consume_golden_ticket(uuid,uuid,uuid,uuid,uuid,jsonb,integer,date) from public,anon,authenticated;

alter table public.club_golden_ticket_redemptions drop constraint if exists club_golden_ticket_identity_required;
alter table public.club_golden_ticket_redemptions add constraint club_golden_ticket_identity_required check (user_id is not null or customer_id is not null);

-- Validate redemption against immutable applied evidence; trusted finalisation must not fabricate it.
create or replace function public.club_consume_golden_ticket(p_organisation_id uuid,p_promotion_id uuid,p_user_id uuid,p_customer_id uuid,p_order_id uuid,p_candidate jsonb,p_saving_minor integer,p_calendar_month date default date_trunc('month',now())::date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_golden_ticket_redemptions%rowtype; v_e public.club_promotion_applied_orders%rowtype;
begin
  if p_user_id is null and p_customer_id is null then raise exception 'Identified finalisation required' using errcode='42501'; end if;
  select * into v_e from public.club_promotion_applied_orders where organisation_id=p_organisation_id and order_id=p_order_id and promotion_id=p_promotion_id for share;
  if not found or v_e.net_minor is null or v_e.saving_minor<>p_saving_minor or (v_e.applied_snapshot->'golden_ticket_candidate') is distinct from p_candidate then raise exception 'Golden Ticket evidence does not match order' using errcode='22023'; end if;
  if not exists(select 1 from public.club_orders where id=p_order_id and organisation_id=p_organisation_id and status in ('paid','fulfilled')) then raise exception 'Order is not complete' using errcode='22023'; end if;
  insert into public.club_golden_ticket_redemptions(organisation_id,promotion_id,user_id,customer_id,calendar_month,order_id,candidate_snapshot,saving_minor) values(p_organisation_id,p_promotion_id,p_user_id,p_customer_id,p_calendar_month,p_order_id,p_candidate,p_saving_minor) on conflict do nothing returning * into v_row;
  if not found then select * into v_row from public.club_golden_ticket_redemptions where organisation_id=p_organisation_id and promotion_id=p_promotion_id and calendar_month=p_calendar_month and ((p_user_id is not null and user_id=p_user_id) or (p_customer_id is not null and customer_id=p_customer_id)) limit 1; end if;
  return to_jsonb(v_row);
end; $$;

-- Administration changes are append-only evidence, without copying sensitive configuration into audit text.
create or replace function public.club_promotion_audit_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.club_audit_events(organisation_id,actor_user_id,action,target_type,target_id,metadata)
  values(coalesce(new.organisation_id,old.organisation_id),coalesce(auth.uid(),new.created_by),case when tg_op='INSERT' then 'promotion.created' when tg_op='UPDATE' then 'promotion.updated' else 'promotion.deleted' end,'promotion',coalesce(new.id,old.id),jsonb_build_object('operation',tg_op,'name',coalesce(new.name,old.name),'status',coalesce(new.status,old.status)));
  return coalesce(new,old);
end; $$;
drop trigger if exists club_promotions_audit on public.club_promotions;
create trigger club_promotions_audit after insert or update or delete on public.club_promotions for each row execute function public.club_promotion_audit_trigger();

-- Canonical order creation now resolves configured promotions in the trusted database path.
create or replace function public.club_create_commerce_order(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_channel text,p_currency text,p_items jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order public.club_orders%rowtype; v_item jsonb; v_product public.club_commerce_products%rowtype; v_qty integer; v_subtotal integer:=0; v_pricing jsonb; v_discount integer; v_staff boolean; v_existing public.club_orders%rowtype; v_applied jsonb;
begin
  if auth.uid() is null or p_channel not in ('member_app','staff_checkout','quick_sale','web','other') or p_currency !~ '^[A-Z]{3}$' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Invalid order input' using errcode='22023'; end if;
  v_staff:=public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']); if not v_staff and p_channel not in ('member_app','web') then raise exception 'Order channel is not permitted' using errcode='42501'; end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Location is unavailable' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and (v_staff or user_id=auth.uid())) then raise exception 'Customer is not in organisation' using errcode='42501'; end if;
  if p_idempotency_key is not null then select * into v_existing from public.club_orders where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return jsonb_build_object('order',to_jsonb(v_existing),'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.club_order_items i where i.order_id=v_existing.id),'[]'::jsonb),'replayed',true); end if; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop v_qty:=(v_item->>'quantity')::integer; if v_qty is null or v_qty<=0 then raise exception 'Invalid order quantity' using errcode='22023'; end if; select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id and active for update; if not found or (v_product.stock_tracked and p_location_id is null) or v_product.currency<>p_currency then raise exception 'Product is unavailable' using errcode='22023'; end if; v_subtotal:=v_subtotal+v_product.sell_price_minor*v_qty; end loop;
  v_pricing:=public.club_evaluate_commerce_promotions(p_organisation_id,p_location_id,auth.uid(),p_customer_id,p_items,null); v_discount:=least(v_subtotal,greatest(0,(v_pricing->>'discount_minor')::integer));
  insert into public.club_orders(organisation_id,location_id,customer_id,user_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,created_by,idempotency_key) values(p_organisation_id,p_location_id,p_customer_id,case when v_staff then null else auth.uid() end,p_channel,'pending_payment',p_currency,v_subtotal,v_discount,v_subtotal-v_discount,auth.uid(),p_idempotency_key) returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_items) loop select * into v_product from public.club_commerce_products where id=(v_item->>'product_id')::uuid and organisation_id=p_organisation_id; v_qty:=(v_item->>'quantity')::integer; insert into public.club_order_items(order_id,organisation_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,stock_tracked) values(v_order.id,p_organisation_id,v_product.id,v_product.name,v_product.sku,v_qty,v_product.sell_price_minor,v_product.sell_price_minor*v_qty,v_product.stock_tracked); end loop;
  for v_applied in select * from jsonb_array_elements(coalesce(v_pricing->'applied','[]'::jsonb)) loop insert into public.club_promotion_applied_orders(organisation_id,order_id,promotion_id,promotion_name,gross_minor,saving_minor,net_minor,applied_snapshot) values(p_organisation_id,v_order.id,(v_applied->>'promotion_id')::uuid,v_applied->>'promotion_name',v_subtotal,(v_applied->>'saving_minor')::integer,v_order.total_minor,jsonb_build_object('promotion',v_applied,'basket',p_items,'golden_ticket_candidate',v_applied->'golden_ticket_candidate')); end loop;
  return jsonb_build_object('order',to_jsonb(v_order),'items',(select jsonb_agg(to_jsonb(i)) from public.club_order_items i where i.order_id=v_order.id),'pricing',v_pricing,'replayed',false);
end; $$;
revoke all on function public.club_create_commerce_order(uuid,uuid,uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.club_create_commerce_order(uuid,uuid,uuid,text,text,jsonb,text) to authenticated;

-- Extend the already-live canonical finaliser. Promotion evidence and Golden Ticket
-- consumption are part of the same locked transaction as stock/service effects.
create or replace function public.club_finalize_paid_order(p_order_id uuid, p_actor_user_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_orders%rowtype; i public.club_order_items%rowtype; p public.club_commerce_products%rowtype; paid integer; customer uuid; e public.club_promotion_applied_orders%rowtype; candidate jsonb;
begin
  select * into o from public.club_orders where id=p_order_id for update;
  if not found or (o.status<>'paid' and not (o.status='pending_payment' and o.total_minor=0)) then raise exception 'Paid order is required for finalisation' using errcode='22023'; end if;
  if o.total_minor>0 then select coalesce(sum(amount_minor),0) into paid from public.club_payments where organisation_id=o.organisation_id and order_id=o.id and status='paid'; if paid<>o.total_minor then raise exception 'Successful tender total does not match order' using errcode='22023'; end if; if exists(select 1 from public.club_promotion_applied_orders e join public.club_promotions pr on pr.id=e.promotion_id where e.order_id=o.id and pr.eligibility->>'payment_method'='balance_only') and exists(select 1 from public.club_payments where order_id=o.id and status='paid' and method<>'balance') then raise exception 'Promotion tender condition was not met' using errcode='22023'; end if; end if;
  if o.status='pending_payment' then update public.club_orders set status='paid',updated_at=now() where id=o.id returning * into o; end if;
  for i in select * from public.club_order_items where order_id=o.id order by id loop
    if i.stock_tracked then insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(o.organisation_id,o.location_id,i.product_id,'sale',-i.quantity,o.id,p_actor_user_id,'order-finalise:'||i.id::text) on conflict (organisation_id,idempotency_key) do nothing; end if;
    select * into p from public.club_commerce_products where id=i.product_id and organisation_id=o.organisation_id;
    if p.service_id is not null then customer:=o.customer_id; if customer is null and o.user_id is not null then select id into customer from public.club_customers where organisation_id=o.organisation_id and user_id=o.user_id limit 1; end if; insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,commerce_order_item_id,metadata) values(o.organisation_id,o.location_id,p.service_id,customer,p_actor_user_id,i.quantity,i.unit_price_minor,o.currency,'paid','commerce',o.id::text,'pending',i.id,jsonb_build_object('commerce_order_id',o.id)) on conflict (commerce_order_item_id) do nothing; end if;
  end loop;
  perform public.club_create_supplier_demand_for_order(o.id);
  for e in select * from public.club_promotion_applied_orders where organisation_id=o.organisation_id and order_id=o.id loop
    if not exists(select 1 from public.club_promotion_applied_orders where id=e.id) then raise exception 'Promotion evidence missing' using errcode='22023'; end if;
    candidate:=e.applied_snapshot->'golden_ticket_candidate'; if candidate is not null and candidate <> 'null'::jsonb then perform public.club_consume_golden_ticket(o.organisation_id,e.promotion_id, o.user_id,o.customer_id,o.id,candidate,e.saving_minor); end if;
  end loop;
end; $$;
revoke all on function public.club_finalize_paid_order(uuid,uuid) from public,anon,authenticated;

-- Final evaluator: targeted bases, repeatable persisted JSON bundle groups and
-- configurable Golden Ticket candidates. All values come from canonical products.
create or replace function public.club_evaluate_commerce_promotions(p_organisation_id uuid,p_location_id uuid,p_user_id uuid,p_customer_id uuid,p_items jsonb,p_payment_method text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare x jsonb; c jsonb; g jsonb; v_candidate jsonb; components jsonb; t public.club_promotion_targets%rowtype; pr public.club_promotions%rowtype; ef public.club_promotion_effects%rowtype; prod public.club_commerce_products%rowtype; gross integer:=0; base integer; saving integer; total integer; applied jsonb:='[]'::jsonb; bundles jsonb; bundle_count integer; group_count integer; group_idx integer; eligible_count integer; candidate_base integer; candidate_save integer; best_save integer:=0; best jsonb; month_start date:=date_trunc('month',now())::date;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Promotion evaluation is not permitted' using errcode='42501'; end if;
  if p_user_id is not null and p_user_id is distinct from auth.uid() and not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Customer is not associated with caller' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'))<>'array' then raise exception 'Invalid basket' using errcode='22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id and active for share; if not found or coalesce((x->>'quantity')::integer,0)<=0 then raise exception 'Product is not sellable' using errcode='22023'; end if; gross:=gross+prod.sell_price_minor*(x->>'quantity')::integer; end loop;
  for pr in select * from public.club_promotions where organisation_id=p_organisation_id and status='active' and now()>=starts_at and (ends_at is null or now()<ends_at) and (cardinality(location_ids)=0 or p_location_id=any(location_ids)) order by coalesce((eligibility->>'priority')::integer,0) desc,id loop
    if pr.eligibility->>'payment_method'='balance_only' and p_payment_method is distinct from 'balance' then continue; end if;
    base:=0;
    for x in select * from jsonb_array_elements(p_items) loop
      select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id;
      if not exists(select 1 from public.club_promotion_targets t0 where t0.promotion_id=pr.id) or exists(select 1 from public.club_promotion_targets t0 where t0.promotion_id=pr.id and (t0.target_type='all_commerce' or (t0.target_type='commerce_product' and t0.commerce_product_id=prod.id) or (t0.target_type='commerce_category' and t0.category_key=prod.category)) ) then base:=base+prod.sell_price_minor*(x->>'quantity')::integer; end if;
    end loop;
    if base=0 then continue; end if;
    select * into ef from public.club_promotion_effects where promotion_id=pr.id order by id limit 1;
    if ef.effect_type='percentage_discount' then saving:=floor(base*ef.percentage_basis_points/10000); elsif ef.effect_type='fixed_discount' then saving:=ef.amount_minor; elsif ef.effect_type='waive_charge' then saving:=base; else saving:=0; end if; saving:=least(base,greatest(0,coalesce(saving,0)));
    if pr.eligibility ? 'bundle_groups' and pr.eligibility ? 'bundle_price_minor' then
      bundles:=public.club_resolve_promotion_bundles(p_organisation_id,p_items,pr.eligibility->'bundle_groups',(pr.eligibility->>'bundle_price_minor')::integer,coalesce((pr.eligibility->>'repeatable')::boolean,true)); bundle_count:=(bundles->>'bundle_count')::integer; group_count:=jsonb_array_length(coalesce(pr.eligibility->'bundle_groups','[]'::jsonb));
      if group_count>0 then
        loop
          group_idx:=0; while group_idx<group_count loop g:=pr.eligibility->'bundle_groups'->group_idx; eligible_count:=0; for x in select * from jsonb_array_elements(p_items) loop select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id; if (g->'product_ids' is null or (g->'product_ids') ? prod.id::text) and (g->'categories' is null or (g->'categories') ? prod.category) then eligible_count:=eligible_count+(x->>'quantity')::integer; end if; end loop; if coalesce((g->>'required_quantity')::integer,0)<=0 then eligible_count:=0; end if; if group_idx=0 or floor(eligible_count/(g->>'required_quantity')::integer)<bundle_count then bundle_count:=floor(eligible_count/(g->>'required_quantity')::integer); end if; group_idx:=group_idx+1; end loop;
          if bundle_count<=0 or coalesce((pr.eligibility->>'repeatable')::boolean,true)=false then exit; end if;
          exit;
        end loop;
      end if;
      if bundle_count>0 then saving:=coalesce((select sum((value->>'saving_minor')::integer) from jsonb_array_elements(bundles->'instances')),0); end if;
      applied:=applied||jsonb_build_array(jsonb_build_object('promotion_id',pr.id,'promotion_name',pr.name,'saving_minor',saving,'effect_type','bundle','priority',coalesce((pr.eligibility->>'priority')::integer,0),'stacking','exclusive','bundle_count',bundle_count,'bundle_groups',pr.eligibility->'bundle_groups','bundle_instances',bundles->'instances','eligible_components',(select coalesce(jsonb_agg(comp),'[]'::jsonb) from jsonb_array_elements(bundles->'instances') bi,jsonb_array_elements(bi->'components') comp),'remaining',bundles->'remaining'));
    elsif saving>0 then
      applied:=applied||jsonb_build_array(jsonb_build_object('promotion_id',pr.id,'promotion_name',pr.name,'saving_minor',saving,'effect_type',ef.effect_type,'base_minor',base,'priority',coalesce((pr.eligibility->>'priority')::integer,0),'stacking',coalesce(pr.eligibility->>'stacking','exclusive'),'eligible_components',public.club_promotion_eligible_components(p_organisation_id,pr.id,p_items)));
    end if;
    if coalesce(pr.eligibility->>'stacking','exclusive')<>'combinable' then exit; end if;
  end loop;
  -- Golden Ticket is opt-in configuration, never inferred from its name.
  for pr in select * from public.club_promotions where organisation_id=p_organisation_id and status='active' and now()>=starts_at and (ends_at is null or now()<ends_at) and coalesce((eligibility->>'golden_ticket')::boolean,false) and nullif(btrim(eligibility->>'entitlement_key'),'') is not null and (p_user_id is not null) and exists(select 1 from public.club_entitlement_grants eg where eg.organisation_id=p_organisation_id and eg.user_id=p_user_id and eg.entitlement_key=pr.eligibility->>'entitlement_key' and eg.starts_at<=now() and (eg.ends_at is null or eg.ends_at>now()) and (eg.membership_id is null or exists(select 1 from public.club_membership_holders mh join public.club_memberships mm on mm.id=mh.membership_id and mm.organisation_id=p_organisation_id where mh.membership_id=eg.membership_id and mh.user_id=p_user_id and mm.status='active'))) and not exists(select 1 from public.club_golden_ticket_redemptions r where r.organisation_id=p_organisation_id and r.promotion_id=pr.id and r.calendar_month=month_start and ((p_user_id is not null and r.user_id=p_user_id) or (p_customer_id is not null and r.customer_id=p_customer_id))) loop
    best:=null; best_save:=0;
    for c in select * from jsonb_array_elements(coalesce(pr.eligibility->'golden_candidates','[]'::jsonb)) loop
      candidate_base:=0; components:='[]'::jsonb;
      if c->>'type'='deal' then
        if coalesce((c->>'compatible')::boolean,false) then
          select value into v_candidate from jsonb_array_elements(applied) as applied_candidate(value) where applied_candidate.value->>'promotion_id'=coalesce(c->>'promotion_id',c->>'id') limit 1;
          if v_candidate is not null then candidate_base:=greatest(0,coalesce((v_candidate->>'input_eligible_base_minor')::integer,(v_candidate->>'base_minor')::integer,0)-coalesce((v_candidate->>'applied_saving_minor')::integer,(v_candidate->>'saving_minor')::integer,0)); components:=coalesce(v_candidate->'eligible_components','[]'::jsonb); end if;
        end if;
      else
        for x in select * from jsonb_array_elements(p_items) loop
          select * into prod from public.club_commerce_products where id=(x->>'product_id')::uuid and organisation_id=p_organisation_id;
          if (c->>'type' in ('product','service','package') and c->>'id'=prod.id::text) or (c->>'type'='category' and c->>'id'=prod.category) or (c->>'type'='group' and ((c->'product_ids' is null or (c->'product_ids') ? prod.id::text) and (c->'categories' is null or (c->'categories') ? prod.category))) then candidate_base:=candidate_base+prod.sell_price_minor*(x->>'quantity')::integer; components:=components||jsonb_build_array(jsonb_build_object('product_id',prod.id,'quantity',(x->>'quantity')::integer,'unit_price_minor',prod.sell_price_minor,'original_minor',prod.sell_price_minor*(x->>'quantity')::integer)); end if;
        end loop;
      end if;
      candidate_save:=floor(candidate_base*2000/10000); if candidate_save>best_save or (candidate_save=best_save and candidate_save>0 and (best is null or (c->>'id')<(best->>'id'))) then best_save:=candidate_save; best:=jsonb_build_object('type',c->>'type','id',c->>'id','base_minor',candidate_base,'saving_minor',candidate_save,'calendar_month',month_start,'saving_rule','20_percent','included_items',components); end if;
    end loop;
    if best is not null and best_save>0 then applied:=applied||jsonb_build_array(jsonb_build_object('promotion_id',pr.id,'promotion_name',pr.name,'saving_minor',best_save,'effect_type','golden_ticket','base_minor',best->>'base_minor','golden_ticket_candidate',best)); end if;
  end loop;
  applied:=public.club_apply_promotion_stack(applied,p_items,gross); total:=greatest(0,gross-(select coalesce(sum((applied_item->>'applied_saving_minor')::integer),0) from jsonb_array_elements(applied) as applied_item)); return jsonb_build_object('gross_minor',gross,'discount_minor',gross-total,'total_minor',total,'applied',applied,'payment_method',p_payment_method);
end; $$;
revoke all on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-02-club-member-joining.sql ===
-- Member joining boundary. Organisations opt in explicitly; no memberships are
-- activated here because payment/provider confirmation remains a separate step.
alter table public.club_organisations add column if not exists member_joinable boolean not null default false;

create table if not exists public.club_membership_join_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null,
  product_id uuid not null,
  status text not null default 'payment_required' check (status in ('details_recorded','payment_required','staff_review','completed','cancelled')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id, idempotency_key),
  foreign key (customer_id, organisation_id) references public.club_customers(id, organisation_id) on delete restrict,
  foreign key (product_id, organisation_id) references public.club_products(id, organisation_id) on delete restrict
);
create index if not exists club_join_requests_user_idx on public.club_membership_join_requests(organisation_id,user_id,created_at desc);
alter table public.club_membership_join_requests enable row level security;
revoke all on table public.club_membership_join_requests from public, anon, authenticated;
grant select on table public.club_membership_join_requests to authenticated;
create policy club_join_requests_subject_select on public.club_membership_join_requests for select to authenticated using (user_id=auth.uid());

create or replace function public.club_list_joinable_organisations()
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',id,'name',name,'slug',slug,'active',active,'branding',branding)
  from public.club_organisations
  where active and member_joinable
  order by name;
$$;

create or replace function public.club_list_joinable_memberships(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',p.id,'organisation_id',p.organisation_id,'name',p.name,'kind',p.kind,'price_minor',p.price_minor,'currency',p.currency,'billing',p.billing,'duration_days',p.duration_days,'sellable',p.sellable)
  from public.club_products p
  join public.club_organisations o on o.id=p.organisation_id and o.active and o.member_joinable
  where p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null
  order by p.name;
$$;

create or replace function public.club_start_membership_joining(p_organisation_id uuid,p_product_id uuid,p_display_name text,p_email text,p_phone text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_customer public.club_customers%rowtype; v_product public.club_products%rowtype; v_request public.club_membership_join_requests%rowtype;
begin
  if v_user is null then raise exception 'Sign in to start joining' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or nullif(btrim(p_display_name),'') is null then raise exception 'Joining details are incomplete' using errcode='22023'; end if;
  if not exists(select 1 from public.club_organisations where id=p_organisation_id and active and member_joinable) then raise exception 'Joining is not available for this organisation' using errcode='42501'; end if;
  select * into v_product from public.club_products where id=p_product_id and organisation_id=p_organisation_id and kind='membership' and sellable and archived_at is null;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then
    if p_email is not null and exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(email)=lower(btrim(p_email)) and user_id is null) then
      raise exception 'An existing membership record may match these details; staff review is required' using errcode='23505';
    end if;
    insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status) values(p_organisation_id,v_user,btrim(p_display_name),nullif(btrim(p_email),''),nullif(btrim(p_phone),''),'customer') returning * into v_customer;
  else
    update public.club_customers set display_name=btrim(p_display_name),email=coalesce(nullif(btrim(p_email),''),email),phone=coalesce(nullif(btrim(p_phone),''),phone),updated_at=now() where id=v_customer.id returning * into v_customer;
  end if;
  select * into v_request from public.club_membership_join_requests where organisation_id=p_organisation_id and user_id=v_user and idempotency_key=p_idempotency_key for update;
  if found then return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product)); end if;
  insert into public.club_membership_join_requests(organisation_id,user_id,customer_id,product_id,status,idempotency_key) values(p_organisation_id,v_user,v_customer.id,v_product.id,'payment_required',btrim(p_idempotency_key)) returning * into v_request;
  return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product));
end; $$;

revoke all on function public.club_list_joinable_organisations() from public,anon;
revoke all on function public.club_list_joinable_memberships(uuid) from public,anon;
revoke all on function public.club_start_membership_joining(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.club_list_joinable_organisations() to authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to authenticated;
grant execute on function public.club_start_membership_joining(uuid,uuid,text,text,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-03-club-product-families.sql ===
-- Product families are presentation groupings; club_commerce_products remain exact SKUs.
create table public.club_product_families (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  brand text, name text not null check (length(btrim(name)) > 0), description text, category text, media jsonb,
  active boolean not null default true, archived_at timestamptz, sort_position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, organisation_id), unique (organisation_id, name), check (media is null or jsonb_typeof(media) = 'object')
);
alter table public.club_commerce_products add column if not exists family_id uuid;
alter table public.club_commerce_products add column if not exists variant_options jsonb not null default '{}'::jsonb;
alter table public.club_commerce_products add constraint club_commerce_products_family_fk foreign key (family_id, organisation_id) references public.club_product_families(id, organisation_id) on delete set null;
alter table public.club_commerce_products add constraint club_commerce_products_variant_options_check check (jsonb_typeof(variant_options) = 'object');
create index club_product_families_org_idx on public.club_product_families(organisation_id, active, sort_position, name);
create index club_commerce_products_family_idx on public.club_commerce_products(organisation_id, family_id, active);

alter table public.club_product_families enable row level security;
create policy club_product_families_select on public.club_product_families for select to authenticated using (
  public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']) or (active and archived_at is null and public.club_has_customer_access(organisation_id))
);
revoke all privileges on table public.club_product_families from public, anon, authenticated;
grant select on table public.club_product_families to authenticated;

create or replace function public.club_save_product_family(p_id uuid, p_organisation_id uuid, p_name text, p_brand text, p_description text, p_category text, p_media jsonb, p_active boolean, p_sort_position integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_product_families%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Product family administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or (p_media is not null and jsonb_typeof(p_media) <> 'object') then raise exception 'Invalid product family input' using errcode='22023'; end if;
  if p_id is null then insert into public.club_product_families(organisation_id,name,brand,description,category,media,active,sort_position) values (p_organisation_id,btrim(p_name),nullif(btrim(p_brand),''),p_description,nullif(btrim(p_category),''),p_media,coalesce(p_active,true),coalesce(p_sort_position,0)) returning * into v_row;
  else update public.club_product_families set name=btrim(p_name),brand=nullif(btrim(p_brand),''),description=p_description,category=nullif(btrim(p_category),''),media=p_media,active=p_active,sort_position=coalesce(p_sort_position,0),updated_at=now() where id=p_id and organisation_id=p_organisation_id returning * into v_row; if not found then raise exception 'Product family not found' using errcode='P0002'; end if; end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_save_product_family(uuid,uuid,text,text,text,text,jsonb,boolean,integer) from public,anon,authenticated;
grant execute on function public.club_save_product_family(uuid,uuid,text,text,text,text,jsonb,boolean,integer) to authenticated;

create or replace function public.club_assign_product_family(p_organisation_id uuid, p_product_id uuid, p_family_id uuid, p_variant_options jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_commerce_products%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) then raise exception 'Product family administration is not permitted' using errcode='42501'; end if;
  if p_variant_options is null or jsonb_typeof(p_variant_options) <> 'object' then raise exception 'Variant options must be an object' using errcode='22023'; end if;
  if p_family_id is not null and not exists(select 1 from public.club_product_families where id=p_family_id and organisation_id=p_organisation_id) then raise exception 'Product family not found' using errcode='P0002'; end if;
  update public.club_commerce_products set family_id=p_family_id, variant_options=p_variant_options, updated_at=now() where id=p_product_id and organisation_id=p_organisation_id returning * into v_row;
  if not found then raise exception 'Commerce product not found' using errcode='P0002'; end if;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.club_assign_product_family(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.club_assign_product_family(uuid,uuid,uuid,jsonb) to authenticated;


-- === APPLY supabase/migrations/2026-10-04-club-stock-replenishment.sql ===
-- Location-specific replenishment review over the existing supplier-cycle rules.
create or replace function public.club_list_replenishment_review(p_organisation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('supplier',s.name,'supplier_id',s.id,'product_id',r.product_id,'product',cp.name,'supplier_sku',sp.supplier_sku,'location_id',r.location_id,'location',l.name,'minimum',r.minimum_quantity,'available',greatest(coalesce((select sum(m.quantity_delta) from public.club_stock_movements m where m.organisation_id=r.organisation_id and m.location_id=r.location_id and m.product_id=r.product_id),0),0),'need',greatest(r.minimum_quantity-greatest(coalesce((select sum(m.quantity_delta) from public.club_stock_movements m where m.organisation_id=r.organisation_id and m.location_id=r.location_id and m.product_id=r.product_id),0),0),0)) order by s.name,cp.name,l.name),'[]'::jsonb)
from public.club_supplier_replenishment_rules r join public.club_supplier_products sp on sp.id=r.supplier_product_id join public.club_suppliers s on s.id=sp.supplier_id join public.club_commerce_products cp on cp.id=r.product_id join public.club_locations l on l.id=r.location_id
where r.organisation_id=p_organisation_id and r.enabled and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage');
$$;
revoke all on function public.club_list_replenishment_review(uuid) from public,anon; grant execute on function public.club_list_replenishment_review(uuid) to authenticated;
create or replace function public.club_save_replenishment_rule(p_organisation_id uuid,p_location_id uuid,p_product_id uuid,p_supplier_product_id uuid,p_minimum_quantity integer,p_target_quantity integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_supplier_replenishment_rules%rowtype;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') then raise exception 'Replenishment management is not permitted' using errcode='42501'; end if;
 if p_minimum_quantity<0 or p_target_quantity<p_minimum_quantity then raise exception 'Invalid replenishment quantities' using errcode='22023'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or not exists(select 1 from public.club_commerce_products where id=p_product_id and organisation_id=p_organisation_id) or not exists(select 1 from public.club_supplier_products where id=p_supplier_product_id and organisation_id=p_organisation_id and club_product_id=p_product_id and sellable and not discontinued) then raise exception 'Replenishment references are invalid' using errcode='22023'; end if;
 insert into public.club_supplier_replenishment_rules(organisation_id,location_id,product_id,supplier_product_id,minimum_quantity,target_quantity,created_by) values(p_organisation_id,p_location_id,p_product_id,p_supplier_product_id,p_minimum_quantity,p_target_quantity,auth.uid()) on conflict(organisation_id,location_id,product_id) do update set supplier_product_id=excluded.supplier_product_id,minimum_quantity=excluded.minimum_quantity,target_quantity=excluded.target_quantity,updated_at=now() returning * into r;
 return to_jsonb(r);
end; $$;
revoke all on function public.club_save_replenishment_rule(uuid,uuid,uuid,uuid,integer,integer) from public,anon; grant execute on function public.club_save_replenishment_rule(uuid,uuid,uuid,uuid,integer,integer) to authenticated;

create table if not exists public.club_supplier_replenishment_allocations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  batch_line_id uuid not null references public.club_supplier_order_batch_lines(id) on delete cascade,
  location_id uuid not null, quantity integer not null check (quantity > 0),
  unique (batch_line_id, location_id), foreign key (organisation_id, location_id) references public.club_locations(organisation_id, id)
);
alter table public.club_supplier_replenishment_allocations enable row level security;
revoke all on public.club_supplier_replenishment_allocations from public,anon,authenticated;

create or replace function public.club_update_replenishment_allocation(p_organisation_id uuid,p_batch_line_id uuid,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare total integer; item jsonb; line record;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') or jsonb_typeof(p_allocations)<>'array' then raise exception 'Replenishment allocation is not permitted' using errcode='42501'; end if;
 select * into line from public.club_supplier_order_batch_lines where id=p_batch_line_id and batch_id in (select id from public.club_supplier_order_batches where organisation_id=p_organisation_id) for update;
 if not found then raise exception 'Supplier order line not found' using errcode='P0002'; end if;
 select coalesce(sum((value->>'quantity')::integer),0) into total from jsonb_array_elements(p_allocations);
 if total<>line.quantity_ordered or exists(select 1 from jsonb_array_elements(p_allocations) value where (value->>'quantity')::integer<1 or not exists(select 1 from public.club_locations where id=(value->>'locationId')::uuid and organisation_id=p_organisation_id and active)) then raise exception 'Allocations must equal the ordered quantity' using errcode='22023'; end if;
 delete from public.club_supplier_replenishment_allocations where batch_line_id=line.id;
 for item in select value from jsonb_array_elements(p_allocations) loop insert into public.club_supplier_replenishment_allocations(organisation_id,batch_line_id,location_id,quantity) values(p_organisation_id,line.id,(item->>'locationId')::uuid,(item->>'quantity')::integer); end loop;
 return jsonb_build_object('batch_line_id',line.id,'quantity_ordered',line.quantity_ordered,'allocations',p_allocations);
end; $$;
revoke all on function public.club_update_replenishment_allocation(uuid,uuid,jsonb) from public,anon; grant execute on function public.club_update_replenishment_allocation(uuid,uuid,jsonb) to authenticated;

create or replace function public.club_list_replenishment_distribution(p_organisation_id uuid,p_batch_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('location_id',a.location_id,'location',l.name,'product_id',sp.club_product_id,'product',coalesce(cp.name,sp.name),'supplier_sku',sp.supplier_sku,'quantity',a.quantity) order by l.name,coalesce(cp.name,sp.name)),'[]'::jsonb)
from public.club_supplier_replenishment_allocations a join public.club_supplier_order_batch_lines bl on bl.id=a.batch_line_id join public.club_supplier_products sp on sp.id=bl.supplier_product_id left join public.club_commerce_products cp on cp.id=sp.club_product_id join public.club_locations l on l.id=a.location_id
where a.organisation_id=p_organisation_id and bl.batch_id=p_batch_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage');
$$;
revoke all on function public.club_list_replenishment_distribution(uuid,uuid) from public,anon; grant execute on function public.club_list_replenishment_distribution(uuid,uuid) to authenticated;

create or replace function public.club_update_replenishment_line(p_organisation_id uuid,p_batch_line_id uuid,p_quantity_ordered integer,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare line public.club_supplier_order_batch_lines%rowtype; total integer;
begin
 if not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage') or p_quantity_ordered<1 or jsonb_typeof(p_allocations)<>'array' then raise exception 'Invalid replenishment update' using errcode='42501'; end if;
 select bl.* into line from public.club_supplier_order_batch_lines bl join public.club_supplier_order_batches b on b.id=bl.batch_id where bl.id=p_batch_line_id and b.organisation_id=p_organisation_id and b.status='draft' for update;
 if not found or line.member_quantity<>0 then raise exception 'Customer demand quantity is not editable' using errcode='22023'; end if;
 select coalesce(sum((value->>'quantity')::integer),0) into total from jsonb_array_elements(p_allocations);
 if total<>p_quantity_ordered or exists(select 1 from jsonb_array_elements(p_allocations) value where (value->>'quantity')::integer<1 or not exists(select 1 from public.club_locations where id=(value->>'locationId')::uuid and organisation_id=p_organisation_id and active)) then raise exception 'Allocations must equal ordered quantity' using errcode='22023'; end if;
 update public.club_supplier_order_batch_lines set quantity_ordered=p_quantity_ordered,replenishment_quantity=p_quantity_ordered,replenishment_location_id=null where id=line.id;
 delete from public.club_supplier_replenishment_allocations where batch_line_id=line.id;
 insert into public.club_supplier_replenishment_allocations(organisation_id,batch_line_id,location_id,quantity) select p_organisation_id,line.id,(value->>'locationId')::uuid,(value->>'quantity')::integer from jsonb_array_elements(p_allocations) value;
 return jsonb_build_object('batch_line_id',line.id,'quantity_ordered',p_quantity_ordered,'allocations',p_allocations);
end; $$;
revoke all on function public.club_update_replenishment_line(uuid,uuid,integer,jsonb) from public,anon; grant execute on function public.club_update_replenishment_line(uuid,uuid,integer,jsonb) to authenticated;
create or replace function public.club_list_replenishment_lines(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'id', bl.id,
      'batch_id', bl.batch_id,
      'quantity_ordered', bl.quantity_ordered,
      'supplier_product_id', bl.supplier_product_id,
      'supplier_sku', sp.supplier_sku,
      'product', coalesce(cp.name, sp.name),
      'supplier', s.name,
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('location_id', a.location_id, 'quantity', a.quantity)) from public.club_supplier_replenishment_allocations a where a.batch_line_id = bl.id), '[]'::jsonb)
    )
  ),
  '[]'::jsonb
)
from public.club_supplier_order_batch_lines bl
join public.club_supplier_order_batches b on b.id = bl.batch_id
join public.club_supplier_products sp on sp.id = bl.supplier_product_id
join public.club_suppliers s on s.id = sp.supplier_id
left join public.club_commerce_products cp on cp.id = sp.club_product_id
where b.organisation_id = p_organisation_id
  and b.status = 'draft'
  and bl.member_quantity = 0
  and bl.replenishment_quantity > 0
  and public.club_capability_allowed(p_organisation_id, auth.uid(), 'supplier.orders_manage');
$$;
revoke all on function public.club_list_replenishment_lines(uuid) from public,anon; grant execute on function public.club_list_replenishment_lines(uuid) to authenticated;


-- === APPLY supabase/migrations/2026-10-05-club-membership-cash-settlement.sql ===
-- Cash membership settlement.  Cash is a billing arrangement/channel, never a shop product.
-- This migration is forward-only and provider-neutral.

alter table public.club_membership_billing_arrangements
  drop constraint if exists club_membership_billing_arrangements_payment_method_family_check;
alter table public.club_membership_billing_arrangements
  add constraint club_membership_billing_arrangements_payment_method_family_check
  check (payment_method_family in ('direct_debit','recurring_card','cash','other'));
alter table public.club_membership_billing_arrangements
  add column if not exists cash_channel text;
alter table public.club_membership_billing_arrangements
  add constraint club_membership_billing_arrangements_cash_channel_check
  check (cash_channel is null or cash_channel in ('staff_counter','member_drop_box'));

alter table public.club_membership_billing_obligations
  drop constraint if exists club_membership_billing_obligations_payment_method_family_check;
alter table public.club_membership_billing_obligations
  add constraint club_membership_billing_obligations_payment_method_family_check
  check (payment_method_family in ('direct_debit','recurring_card','cash','other'));
alter table public.club_membership_billing_obligations
  add column if not exists cash_channel text;
alter table public.club_membership_billing_obligations
  add constraint club_membership_billing_obligations_cash_channel_check
  check (cash_channel is null or cash_channel in ('staff_counter','member_drop_box'));

alter table public.club_cash_declarations add column if not exists obligation_id uuid;
alter table public.club_cash_declarations add column if not exists cash_channel text;
alter table public.club_cash_declarations
  add constraint club_cash_declarations_obligation_fk
  foreign key (obligation_id, organisation_id)
  references public.club_membership_billing_obligations(id, organisation_id);
alter table public.club_cash_declarations
  add constraint club_cash_declarations_cash_channel_check
  check (cash_channel is null or cash_channel in ('staff_counter','member_drop_box'));
create index if not exists club_cash_declarations_obligation_idx on public.club_cash_declarations(organisation_id, obligation_id);

create or replace function public.club_bind_membership_cash_declaration()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.purpose='membership' and new.obligation_id is null then
    select o.id into new.obligation_id
    from public.club_membership_billing_obligations o
    where o.organisation_id=new.organisation_id and o.membership_id=new.membership_id
      and (o.user_id=new.user_id or (new.customer_id is not null and o.customer_id=new.customer_id))
      and o.payment_method_family='cash' and o.state not in ('paid','recovered','cancelled','waived')
      and o.amount_minor=new.declared_amount_minor and o.currency=new.currency
    order by o.next_due_at limit 1;
    if new.obligation_id is null then raise exception 'Membership cash declaration requires an outstanding cash obligation' using errcode='22023'; end if;
  end if;
  if new.purpose='membership' then new.cash_channel:=coalesce(new.cash_channel,'member_drop_box'); end if;
  return new;
end; $$;
drop trigger if exists club_bind_membership_cash_declaration_trigger on public.club_cash_declarations;
create trigger club_bind_membership_cash_declaration_trigger before insert on public.club_cash_declarations for each row execute function public.club_bind_membership_cash_declaration();

-- Keep enrolment provider-neutral while allowing a cash arrangement and its explicit channel.
create or replace function public.club_enrol_membership_billing(p_organisation_id uuid,p_membership_id uuid,p_user_id uuid,p_customer_id uuid,p_provider_type text,p_payment_method_family text,p_amount_minor integer,p_currency text,p_frequency text,p_next_due_at timestamptz,p_provider_customer_reference text,p_provider_subscription_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; a public.club_membership_billing_arrangements%rowtype; o public.club_membership_billing_obligations%rowtype; period text; channel text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Billing administration is not permitted' using errcode='42501'; end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for share;
  if not found or not exists(select 1 from public.club_membership_holders where membership_id=m.id and user_id=p_user_id) then raise exception 'Membership billing identity is invalid' using errcode='22023'; end if;
  if p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' or p_payment_method_family not in ('direct_debit','recurring_card','cash','other') or p_frequency not in ('weekly','monthly','quarterly','annual','other') or p_next_due_at is null then raise exception 'Invalid billing obligation' using errcode='22023'; end if;
  channel:=case when p_payment_method_family='cash' then 'staff_counter' else null end;
  insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,provider_customer_reference,provider_subscription_reference)
  values(p_organisation_id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,channel,p_amount_minor,p_currency,p_frequency,p_next_due_at,p_provider_customer_reference,p_provider_subscription_reference)
  on conflict (organisation_id,membership_id) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,provider_type=excluded.provider_type,payment_method_family=excluded.payment_method_family,cash_channel=excluded.cash_channel,amount_minor=excluded.amount_minor,currency=excluded.currency,frequency=excluded.frequency,next_due_at=excluded.next_due_at,provider_customer_reference=excluded.provider_customer_reference,provider_subscription_reference=excluded.provider_subscription_reference,state='active',updated_at=now()
  returning * into a;
  period:=to_char(p_next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,period_key)
  values(p_organisation_id,a.id,p_membership_id,p_user_id,p_customer_id,p_provider_type,p_payment_method_family,a.cash_channel,p_amount_minor,p_currency,p_frequency,p_next_due_at,period)
  on conflict (arrangement_id,period_key) do nothing returning * into o;
  if o.id is null then select * into o from public.club_membership_billing_obligations where arrangement_id=a.id and period_key=period; end if;
  return jsonb_build_object('arrangement',to_jsonb(a),'obligation',to_jsonb(o));
end; $$;

-- Shared exact-obligation settlement used by staff counter cash and verification.
create or replace function public.club_record_membership_cash_payment(p_organisation_id uuid,p_obligation_id uuid,p_location_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; a public.club_membership_billing_arrangements%rowtype; pay public.club_membership_billing_payments%rowtype; next_due timestamptz; next_period text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Membership cash payment is not permitted' using errcode='42501'; end if;
  if p_location_id is null or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) or not public.club_location_authorized(p_organisation_id,p_location_id) then raise exception 'A physical authorised location is required' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or p_amount_minor<=0 or p_currency !~ '^[A-Z]{3}$' then raise exception 'Invalid membership cash payment' using errcode='22023'; end if;
  select * into pay from public.club_membership_billing_payments where organisation_id=p_organisation_id and provider_event_key=p_idempotency_key;
  if found then return to_jsonb(pay); end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id for update;
  if not found or o.payment_method_family<>'cash' or o.state in ('paid','recovered','cancelled','waived') or p_amount_minor<>o.amount_minor or p_currency<>o.currency then raise exception 'Cash amount does not match an outstanding membership obligation' using errcode='22023'; end if;
  insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key) values(p_organisation_id,o.id,p_amount_minor,p_currency,'staff-cash:'||p_idempotency_key,p_idempotency_key) returning * into pay;
  update public.club_membership_billing_obligations set state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,last_paid_at=now(),last_payment_reference=pay.id::text,failure_reason=null,updated_at=now() where id=o.id;
  select * into a from public.club_membership_billing_arrangements where id=o.arrangement_id and organisation_id=o.organisation_id for update;
  next_due:=public.club_next_membership_billing_due(a.next_due_at,a.frequency);
  if next_due is not null and a.next_due_at<=o.next_due_at then
    next_period:=to_char(next_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    insert into public.club_membership_billing_obligations(organisation_id,arrangement_id,membership_id,user_id,customer_id,provider_type,payment_method_family,cash_channel,amount_minor,currency,frequency,next_due_at,period_key) values(a.organisation_id,a.id,a.membership_id,a.user_id,a.customer_id,a.provider_type,a.payment_method_family,a.cash_channel,a.amount_minor,a.currency,a.frequency,next_due,next_period) on conflict (arrangement_id,period_key) do nothing;
    update public.club_membership_billing_arrangements set next_due_at=next_due,last_successful_payment_at=now(),updated_at=now() where id=a.id;
  end if;
  return jsonb_build_object('payment',to_jsonb(pay),'obligation',(select to_jsonb(x) from public.club_membership_billing_obligations x where x.id=o.id));
end; $$;

-- Explicit member drop-box declaration: it records intent only and never settles.
create or replace function public.club_declare_membership_cash_drop(p_organisation_id uuid,p_obligation_id uuid,p_location_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_membership_billing_obligations%rowtype; d public.club_cash_declarations%rowtype;
begin
  if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['member','trainer','gym_staff','gym_admin','owner']) then raise exception 'Cash declaration is not permitted' using errcode='42501'; end if;
  if p_location_id is null or not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'A physical deposit location is required' using errcode='22023'; end if;
  select * into o from public.club_membership_billing_obligations where id=p_obligation_id and organisation_id=p_organisation_id and user_id=auth.uid() for share;
  if not found or o.payment_method_family<>'cash' or o.state in ('paid','recovered','cancelled','waived') or p_amount_minor<>o.amount_minor or p_currency<>o.currency then raise exception 'Cash declaration does not match an outstanding obligation' using errcode='22023'; end if;
  select * into d from public.club_cash_declarations where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(d); end if;
  insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,membership_id,obligation_id,declared_amount_minor,currency,cash_channel,idempotency_key) values(p_organisation_id,p_location_id,'membership',auth.uid(),o.customer_id,o.membership_id,o.id,p_amount_minor,p_currency,'member_drop_box',p_idempotency_key) returning * into d;
  return to_jsonb(d);
end; $$;

create or replace function public.club_list_customer_billing(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'membership_id',o.membership_id,'amount_minor',o.amount_minor,'currency',o.currency,'next_due_at',o.next_due_at,'state',o.state,'payment_method_family',o.payment_method_family,'cash_channel',o.cash_channel,'failure_reason',o.failure_reason) order by o.next_due_at),'[]'::jsonb)
from public.club_membership_billing_obligations o where o.organisation_id=p_organisation_id and (o.customer_id=p_customer_id or exists(select 1 from public.club_customers c where c.id=p_customer_id and c.organisation_id=o.organisation_id and c.user_id=o.user_id)) and public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take');
$$;

-- Replace the generic reconciliation boundary so a confirmed membership
-- declaration creates a billing payment, while commerce declarations retain
-- their existing order reconciliation behaviour.
create or replace function public.club_reconcile_cash_declaration(p_declaration_id uuid,p_status text,p_notes text,p_discrepancy_minor integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.club_cash_declarations%rowtype; o public.club_membership_billing_obligations%rowtype; pay public.club_membership_billing_payments%rowtype; ord public.club_orders%rowtype; item public.club_order_items%rowtype;
begin
  select * into d from public.club_cash_declarations where id=p_declaration_id for update;
  if not found or not public.club_has_active_role(d.organisation_id,array['gym_staff','gym_admin','owner']) or not public.club_capability_allowed(d.organisation_id,auth.uid(),'cash.reconcile') then raise exception 'Cash reconciliation is not permitted' using errcode='42501'; end if;
  if d.status<>'declared' then if d.status=p_status then return to_jsonb(d); else raise exception 'Cash declaration decision conflicts' using errcode='23505'; end if; end if;
  if p_status not in ('confirmed','rejected','discrepancy') then raise exception 'Cash declaration is not reconcilable' using errcode='22023'; end if;
  if d.purpose='membership' then
    if p_status='confirmed' then
      select * into o from public.club_membership_billing_obligations where id=d.obligation_id and organisation_id=d.organisation_id for update;
      if not found or o.payment_method_family<>'cash' or o.state in ('paid','recovered','cancelled','waived') or o.amount_minor<>d.declared_amount_minor then raise exception 'Membership obligation is not eligible for cash confirmation' using errcode='22023'; end if;
      insert into public.club_membership_billing_payments(organisation_id,obligation_id,amount_minor,currency,provider_reference,provider_event_key) values(d.organisation_id,o.id,d.declared_amount_minor,d.currency,'drop-box:'||d.id,'cash-declaration:'||d.id) on conflict (organisation_id,provider_event_key) do nothing returning * into pay;
      update public.club_membership_billing_obligations set state=case when state in ('failed','grace','retry_scheduled','overdue') then 'recovered' else 'paid' end,last_paid_at=now(),last_payment_reference=coalesce(pay.id::text,'cash-declaration:'||d.id),updated_at=now() where id=o.id;
    end if;
  elsif d.purpose='commerce_order' and p_status='confirmed' then
    select * into ord from public.club_orders where id=d.order_id and organisation_id=d.organisation_id for update;
    if not found or ord.status<>'awaiting_cash_verification' then raise exception 'Order is not awaiting cash confirmation' using errcode='22023'; end if;
    insert into public.club_payments(order_id,organisation_id,method,amount_minor,currency,status,external_reference) values(ord.id,ord.organisation_id,'cash',ord.total_minor,ord.currency,'paid',coalesce(d.idempotency_key,d.id::text)) on conflict do nothing;
    for item in select * from public.club_order_items where order_id=ord.id and stock_tracked loop
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key) values(ord.organisation_id,ord.location_id,item.product_id,'sale',-item.quantity,ord.id,auth.uid(),'cash-confirmed:'||d.id::text||':'||item.id::text) on conflict (organisation_id,idempotency_key) do nothing;
    end loop;
    update public.club_orders set status='paid',updated_at=now() where id=ord.id;
  elsif d.purpose='commerce_order' and p_status in ('rejected','discrepancy') then
    update public.club_orders set status='cash_disputed',updated_at=now() where id=d.order_id and organisation_id=d.organisation_id and status='awaiting_cash_verification';
  end if;
  update public.club_cash_declarations set status=p_status,confirmed_at=now(),confirmed_by=auth.uid(),notes=p_notes,discrepancy_minor=p_discrepancy_minor,updated_at=now() where id=d.id returning * into d;
  return to_jsonb(d);
end; $$;

revoke all on function public.club_record_membership_cash_payment(uuid,uuid,uuid,integer,text,text),public.club_declare_membership_cash_drop(uuid,uuid,uuid,integer,text,text),public.club_list_customer_billing(uuid,uuid) from public,anon;
grant execute on function public.club_record_membership_cash_payment(uuid,uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.club_declare_membership_cash_drop(uuid,uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.club_list_customer_billing(uuid,uuid) to authenticated;

comment on table public.club_membership_billing_obligations is 'Provider-neutral obligations; cash arrangements remain due until staff counter settlement or verified drop-box cash.';


-- === APPLY supabase/migrations/2026-10-06-fix-commerce-promotion-alias.sql ===
-- Correct the live commerce promotion evaluator without changing its business rules.
-- The declared PL/pgSQL variable `a` conflicted with the table alias `a` in the
-- final aggregate, causing create_commerce_order to fail with SQLSTATE 42702.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure)
    into definition;
  definition := replace(definition,
    'from jsonb_array_elements(applied) a));',
    'from jsonb_array_elements(applied) applied_row));');
  definition := replace(definition,
    'sum((a->>''applied_saving_minor'')::integer)',
    'sum((applied_row->>''applied_saving_minor'')::integer)');
  if definition = pg_get_functiondef('public.club_evaluate_commerce_promotions(uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure) then
    raise exception 'Expected promotion alias was not found';
  end if;
  execute definition;
end $$;


-- === APPLY supabase/migrations/2026-10-07-fix-finalise-promotion-alias.sql ===
-- Qualify the SQL alias used by order finalisation.  The promotion finaliser
-- also declares PL/pgSQL record `e`; reusing `e` as a query alias makes
-- e.promotion_id ambiguous (42702) when a paid order is finalised.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure)
    into definition;
  definition := replace(definition,
    'from public.club_promotion_applied_orders e join public.club_promotions pr on pr.id=e.promotion_id where e.order_id=o.id',
    'from public.club_promotion_applied_orders applied_promotion join public.club_promotions pr on pr.id=applied_promotion.promotion_id where applied_promotion.order_id=o.id');
  if definition = pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure) then
    raise exception 'Expected finalisation promotion alias was not found';
  end if;
  execute definition;
end $$;


-- === APPLY supabase/migrations/2026-10-08-fix-stock-idempotency-constraint.sql ===
-- Final paid-order settlement is idempotent per organisation and movement key.
-- Ensure the constraint assumed by the canonical finaliser exists before the
-- stock movement ON CONFLICT target is used.
create unique index if not exists club_stock_movements_idempotency_unique
  on public.club_stock_movements (organisation_id, idempotency_key)
  where idempotency_key is not null;


-- === APPLY supabase/migrations/2026-10-09-fix-stock-conflict-target.sql ===
-- Match the stock idempotency conflict target to its partial unique index.
-- PostgreSQL cannot infer a partial index unless the conflict predicate is
-- included in the ON CONFLICT target.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure)
    into definition;
  definition := replace(definition,
    'on conflict (organisation_id,idempotency_key) do nothing',
    'on conflict (organisation_id,idempotency_key) where idempotency_key is not null do nothing');
  if definition = pg_get_functiondef('public.club_finalize_paid_order(uuid,uuid)'::regprocedure) then
    raise exception 'Expected stock conflict target was not found';
  end if;
  execute definition;
end $$;


-- === APPLY supabase/migrations/2026-10-10-club-cancel-pending-orders.sql ===
-- Allow authorised staff to void abandoned staff checkout orders without touching stock or payments.
create or replace function public.club_cancel_staff_pending_order(p_organisation_id uuid, p_order_id uuid)
returns public.club_orders
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_orders%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'payments.record_cash') then
    raise exception 'Order cancellation denied' using errcode='42501';
  end if;
  select * into r from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update;
  if not found or r.channel <> 'staff_checkout' or r.status <> 'pending_payment' then
    raise exception 'Order is not an abandoned staff checkout' using errcode='22023';
  end if;
  update public.club_orders set status='cancelled', updated_at=now() where id=r.id returning * into r;
  return r;
end; $$;
revoke all on function public.club_cancel_staff_pending_order(uuid,uuid) from public,anon;
grant execute on function public.club_cancel_staff_pending_order(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-10-11-club-staff-split-tender.sql ===
-- Atomic staff Balance + Cash settlement.  This is a pending migration and
-- must be applied after the existing Club commerce and Balance migrations.
create or replace function public.club_ensure_balance_account(p_organisation_id uuid,p_customer_id uuid,p_currency text)
returns public.club_balance_accounts language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_balance_accounts%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.take') then raise exception 'Balance access denied' using errcode='42501'; end if;
  select * into r from public.club_balance_accounts where organisation_id=p_organisation_id and customer_id=p_customer_id for update;
  if not found then insert into public.club_balance_accounts(organisation_id,customer_id,currency) values(p_organisation_id,p_customer_id,p_currency) returning * into r; end if;
  return r;
end; $$;
revoke all on function public.club_ensure_balance_account(uuid,uuid,text) from public,anon;
grant execute on function public.club_ensure_balance_account(uuid,uuid,text) to authenticated;

create or replace function public.club_staff_settle_split_payment(
  p_order_id uuid,
  p_balance_minor integer,
  p_cash_minor integer,
  p_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_order public.club_orders%rowtype;
  v_account public.club_balance_accounts%rowtype;
  v_entry public.club_balance_entries%rowtype;
  v_balance integer;
  v_item public.club_order_items%rowtype;
  v_existing_balance public.club_payments%rowtype;
  v_existing_cash public.club_payments%rowtype;
begin
  select * into v_order from public.club_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(v_order.organisation_id,auth.uid(),'payments.record_cash') then
    raise exception 'Split settlement is not permitted' using errcode='42501';
  end if;
  if p_balance_minor < 0 or p_cash_minor < 0 or p_balance_minor + p_cash_minor <> v_order.total_minor
     or v_order.total_minor <= 0 or coalesce(length(btrim(p_idempotency_key)),0)=0 then
    raise exception 'Split payment amount is invalid' using errcode='22023';
  end if;
  select * into v_existing_balance from public.club_payments
    where order_id=v_order.id and organisation_id=v_order.organisation_id
      and external_reference=p_idempotency_key||':balance';
  select * into v_existing_cash from public.club_payments
    where order_id=v_order.id and organisation_id=v_order.organisation_id
      and external_reference=p_idempotency_key||':cash';
  if v_existing_balance.id is not null or v_existing_cash.id is not null then
    if v_order.status='paid' and ((p_balance_minor=0 and v_existing_balance.id is null) or (p_balance_minor>0 and v_existing_balance.id is null) or (p_cash_minor=0 and v_existing_cash.id is null) or (p_cash_minor>0 and v_existing_cash.id is null)) then
      raise exception 'Split payment idempotency conflict' using errcode='23505';
    end if;
    if v_order.status='paid' then return jsonb_build_object('status','paid','order_id',v_order.id,'replayed',true); end if;
    raise exception 'Split payment is not awaiting settlement' using errcode='22023';
  end if;
  if v_order.status<>'pending_payment' or v_order.customer_id is null then
    raise exception 'Order is not eligible for split payment' using errcode='22023';
  end if;
  if p_balance_minor > 0 then
    select * into v_account from public.club_balance_accounts where organisation_id=v_order.organisation_id and customer_id=v_order.customer_id for update;
    if not found then raise exception 'Balance account not found' using errcode='P0002'; end if;
    v_balance:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=v_account.id),0);
    if v_balance < p_balance_minor then raise exception 'Insufficient organisation balance' using errcode='22023'; end if;
    insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,order_id,actor_user_id,idempotency_key)
      values(v_account.id,v_order.organisation_id,'purchase',-p_balance_minor,v_balance-p_balance_minor,v_order.id,auth.uid(),p_idempotency_key||':balance') returning * into v_entry;
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status)
      values(v_order.id,v_order.organisation_id,'balance',p_idempotency_key||':balance',p_balance_minor,v_order.currency,'paid');
  end if;
  if p_cash_minor > 0 then
    insert into public.club_payments(order_id,organisation_id,method,external_reference,amount_minor,currency,status)
      values(v_order.id,v_order.organisation_id,'cash',p_idempotency_key||':cash',p_cash_minor,v_order.currency,'paid');
  end if;
  update public.club_orders set status='paid',updated_at=now() where id=v_order.id;
  for v_item in select * from public.club_order_items where order_id=v_order.id and stock_tracked loop
    insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,order_id,actor_user_id,idempotency_key)
      values(v_order.organisation_id,v_order.location_id,v_item.product_id,'sale',-v_item.quantity,v_order.id,auth.uid(),p_idempotency_key||':'||v_item.id)
      on conflict (organisation_id,idempotency_key) where idempotency_key is not null do nothing;
  end loop;
  perform public.club_finalize_paid_order(v_order.id,auth.uid());
  return jsonb_build_object('status','paid','order_id',v_order.id,'balance_minor',p_balance_minor,'cash_minor',p_cash_minor);
end; $$;

revoke all on function public.club_staff_settle_split_payment(uuid,integer,integer,text) from public,anon;
grant execute on function public.club_staff_settle_split_payment(uuid,integer,integer,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-12-fix-balance-cash-topup.sql ===
-- Correct the cash top-up contract: declaration and ledger credit are one
-- idempotent transaction, and replay returns the existing credit.
create or replace function public.club_record_balance_cash_top_up(p_organisation_id uuid,p_location_id uuid,p_customer_id uuid,p_amount_minor integer,p_currency text,p_idempotency_key text,p_notes text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; a public.club_balance_accounts%rowtype; e public.club_balance_entries%rowtype; existing public.club_balance_entries%rowtype; b integer;
begin
 if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'payments.record_cash') then raise exception 'Cash top-up is not permitted' using errcode='42501'; end if;
 if p_amount_minor<=0 or p_customer_id is null or p_location_id is null or coalesce(length(btrim(p_idempotency_key)),0)=0 then raise exception 'Invalid balance top-up' using errcode='22023'; end if;
 select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share; if not found then raise exception 'Member not found' using errcode='P0002'; end if;
 select * into existing from public.club_balance_entries where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(existing); end if;
 select * into a from public.club_balance_accounts where organisation_id=p_organisation_id and customer_id=p_customer_id for update;
 if not found then insert into public.club_balance_accounts(organisation_id,customer_id,user_id,currency) values(p_organisation_id,p_customer_id,c.user_id,p_currency) returning * into a; end if;
 if a.currency<>p_currency or a.status<>'active' then raise exception 'Balance account is unavailable' using errcode='22023'; end if;
 insert into public.club_cash_declarations(organisation_id,location_id,purpose,user_id,customer_id,declared_amount_minor,currency,status,confirmed_at,confirmed_by,notes,idempotency_key) values(p_organisation_id,p_location_id,'balance_top_up',c.user_id,p_customer_id,p_amount_minor,p_currency,'confirmed',now(),auth.uid(),p_notes,p_idempotency_key);
 b:=coalesce((select sum(amount_delta_minor) from public.club_balance_entries where account_id=a.id),0);
 insert into public.club_balance_entries(account_id,organisation_id,entry_type,amount_delta_minor,balance_after_minor,actor_user_id,reason,idempotency_key) values(a.id,p_organisation_id,'top_up',p_amount_minor,b+p_amount_minor,auth.uid(),coalesce(p_notes,'Cash top-up'),p_idempotency_key) returning * into e;
 return to_jsonb(e);
end; $$;
revoke all on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) from public,anon;
grant execute on function public.club_record_balance_cash_top_up(uuid,uuid,uuid,integer,text,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-14-club-supplier-cost-history.sql ===
-- Internal supplier-cost history only; never exposed by member catalogue RPCs.
create table if not exists public.club_supplier_variant_costs (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete restrict, supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict,
  cost_minor integer not null check (cost_minor >= 0), currency text not null default 'GBP', observed_at timestamptz not null, source_reference text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists club_supplier_variant_costs_lookup on public.club_supplier_variant_costs(organisation_id,supplier_product_id,observed_at desc);
alter table public.club_supplier_variant_costs enable row level security;
revoke all on public.club_supplier_variant_costs from anon,authenticated;
create or replace function public.club_record_supplier_variant_cost(p_organisation_id uuid,p_supplier_id uuid,p_supplier_product_id uuid,p_cost_minor integer,p_currency text,p_observed_at timestamptz,p_source_reference text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare id uuid; begin if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier cost access is not permitted' using errcode='42501'; end if; if p_cost_minor is null or p_cost_minor<0 then raise exception 'Invalid supplier cost' using errcode='22023'; end if; insert into public.club_supplier_variant_costs(organisation_id,supplier_id,supplier_product_id,cost_minor,currency,observed_at,source_reference,created_by) values(p_organisation_id,p_supplier_id,p_supplier_product_id,p_cost_minor,coalesce(nullif(p_currency,''),'GBP'),p_observed_at,p_source_reference,auth.uid()) returning id into id; return jsonb_build_object('id',id); end; $$;
revoke all on function public.club_record_supplier_variant_cost(uuid,uuid,uuid,integer,text,timestamptz,text) from public,anon; grant execute on function public.club_record_supplier_variant_cost(uuid,uuid,uuid,integer,text,timestamptz,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-14-glow-zone-operations.sql ===
-- Additive follow-up for the already-installed Glow Zone transaction contract.
create table if not exists public.club_glow_adjustments (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null, user_id uuid not null,
 location_id uuid not null, minutes integer not null check (minutes>0), direction text not null check (direction in ('add','remove')),
 reason text not null, actor_user_id uuid not null references auth.users(id), allocations jsonb not null default '[]'::jsonb,
 idempotency_key text not null, created_at timestamptz not null default now(), unique (organisation_id,idempotency_key)
);
alter table public.club_glow_adjustments enable row level security;
drop policy if exists glow_adjustments_self_staff on public.club_glow_adjustments;
create policy glow_adjustments_self_staff on public.club_glow_adjustments for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create or replace function public.club_glow_adjust_remove(p_organisation_id uuid,p_user_id uuid,p_location_id uuid,p_minutes integer,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.club_glow_adjustments%rowtype; l record; take integer; left_qty integer:=p_minutes; alloc jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_admin','owner']) or p_minutes<=0 or nullif(trim(p_reason),'') is null then raise exception 'Glow Zone removal is not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 select * into a from public.club_glow_adjustments where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(a); end if;
 for l in select * from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id and credit_key='sunbed_minutes' and remaining_quantity>0 and (expires_at is null or expires_at>now()) order by expires_at nulls last,granted_at,id for update loop exit when left_qty=0; take:=least(left_qty,l.remaining_quantity); update public.club_service_credit_lots set remaining_quantity=remaining_quantity-take where id=l.id; alloc:=alloc||jsonb_build_array(jsonb_build_object('lot_id',l.id,'quantity',take)); left_qty:=left_qty-take; end loop;
 if left_qty>0 then raise exception 'Insufficient Glow Zone minutes' using errcode='22023'; end if;
 insert into public.club_glow_adjustments(organisation_id,user_id,location_id,minutes,direction,reason,actor_user_id,allocations,idempotency_key) values(p_organisation_id,p_user_id,p_location_id,p_minutes,'remove',trim(p_reason),auth.uid(),alloc,p_idempotency_key) returning * into a; return to_jsonb(a);
end; $$;
revoke all on function public.club_glow_adjust_remove(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated; grant execute on function public.club_glow_adjust_remove(uuid,uuid,uuid,integer,text,text) to authenticated;

create or replace function public.club_glow_history(p_organisation_id uuid,p_user_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(x order by created_at desc),'[]'::jsonb) from (
  select jsonb_build_object('kind','credit','minutes',original_quantity,'remaining',remaining_quantity,'source',source_type,'reason',source_reference,'expires_at',expires_at,'location_id',location_id,'created_at',created_at) as x, created_at from public.club_service_credit_lots where organisation_id=p_organisation_id and user_id=p_user_id
  union all select jsonb_build_object('kind','usage','minutes',-minutes,'source','usage','created_at',created_at,'location_id',location_id,'qualifying_loyalty',qualifying_loyalty) as x,created_at from public.club_service_credit_usage where organisation_id=p_organisation_id and user_id=p_user_id
  union all select jsonb_build_object('kind','adjustment','minutes',case when direction='add' then minutes else -minutes end,'source','manual_adjustment','reason',reason,'created_at',created_at,'location_id',location_id) as x,created_at from public.club_glow_adjustments where organisation_id=p_organisation_id and user_id=p_user_id
 ) x where auth.uid()=p_user_id or public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']); $$;
revoke all on function public.club_glow_history(uuid,uuid) from public,anon,authenticated; grant execute on function public.club_glow_history(uuid,uuid) to authenticated;

create or replace function public.club_glow_loyalty(p_organisation_id uuid,p_user_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('qualifying_sessions',coalesce(sum(case when qualifying_loyalty then 1 else 0 end),0),'threshold',9,'reward_earned',coalesce(sum(case when qualifying_loyalty then 1 else 0 end),0)>=9) from public.club_service_credit_usage where organisation_id=p_organisation_id and user_id=p_user_id and (auth.uid()=p_user_id or public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner'])); $$;
revoke all on function public.club_glow_loyalty(uuid,uuid) from public,anon,authenticated; grant execute on function public.club_glow_loyalty(uuid,uuid) to authenticated;


-- === APPLY supabase/migrations/2026-10-15-club-catalogue-enrichment.sql ===
-- Verified catalogue metadata only. No price, supplier availability or inventory fields are stored here.
create table if not exists public.club_supplier_variant_enrichment (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
 supplier_product_id uuid not null references public.club_supplier_products(id) on delete cascade,
 description text, nutrition jsonb, ingredients text, allergens text, storage_use text,
 parent_image_url text, variant_image_url text, source_url text, source_type text, verified_at timestamptz,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organisation_id,supplier_product_id)
);
alter table public.club_supplier_variant_enrichment enable row level security;
revoke all on public.club_supplier_variant_enrichment from anon,authenticated;


-- === APPLY supabase/migrations/2026-10-15-glow-zone-reception-sales.sql ===
-- Staff-confirmed reception tender and atomic purchased-minute fulfilment.
create table if not exists public.club_glow_sales (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null, location_id uuid not null, user_id uuid not null,
 package_id text not null, minutes integer not null check (minutes>0), amount_minor integer not null check (amount_minor>0),
 tender_type text not null check (tender_type in ('cash','external_card')), tender_confirmed_at timestamptz not null default now(),
 actor_user_id uuid not null references auth.users(id), seller_name text not null default 'MADHOUSE PRODUCTS AND SERVICES LIMITED', seller_company_number text not null default '17383213',
 idempotency_key text not null, status text not null default 'completed' check (status='completed'), created_at timestamptz not null default now(), unique(organisation_id,idempotency_key)
);
alter table public.club_glow_sales enable row level security;
drop policy if exists glow_sales_self_staff on public.club_glow_sales;
create policy glow_sales_self_staff on public.club_glow_sales for select to authenticated using (user_id=auth.uid() or public.club_has_active_role(organisation_id,array['gym_staff','gym_admin','owner']));
create or replace function public.club_glow_complete_sale(p_organisation_id uuid,p_location_id uuid,p_user_id uuid,p_package_id text,p_minutes integer,p_tender_type text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_glow_sales%rowtype; price integer; age_ok boolean;
begin
 if auth.uid() is null or not public.club_has_active_role(p_organisation_id,array['gym_staff','gym_admin','owner']) then raise exception 'Sale not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and lower(name) like '%carlton%') then raise exception 'Glow Zone is only available at Carlton' using errcode='22023'; end if;
 select * into s from public.club_glow_sales where organisation_id=p_organisation_id and idempotency_key=p_idempotency_key; if found then return to_jsonb(s); end if;
 if p_package_id='member-30' then price:=1000; if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='member') then raise exception 'Member package requires active membership' using errcode='42501'; end if;
 elsif p_package_id='member-100' then price:=3000; if not exists(select 1 from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active and role='member') then raise exception 'Member package requires active membership' using errcode='42501'; end if;
 elsif p_package_id='quick-30' then price:=1800; elsif p_package_id='bronze-60' then price:=3000; elsif p_package_id='full-100' then price:=5000; elsif p_package_id='payg' then price:=p_minutes*100; else raise exception 'Unknown Glow Zone package' using errcode='22023'; end if;
 if p_minutes<=0 or (p_package_id<>'payg' and ((p_package_id like '%30' and p_minutes<>30) or (p_package_id like '%60' and p_minutes<>60) or (p_package_id like '%100' and p_minutes<>100))) then raise exception 'Invalid Glow Zone quantity' using errcode='22023'; end if;
 insert into public.club_glow_sales(organisation_id,location_id,user_id,package_id,minutes,amount_minor,tender_type,actor_user_id,idempotency_key) values(p_organisation_id,p_location_id,p_user_id,p_package_id,p_minutes,price,p_tender_type,auth.uid(),p_idempotency_key) returning * into s;
 insert into public.club_service_credit_lots(organisation_id,user_id,credit_key,unit,original_quantity,remaining_quantity,expires_at,source_type,source_reference,location_id,actor_user_id,idempotency_key) values(p_organisation_id,p_user_id,'sunbed_minutes','minute',p_minutes,p_minutes,now()+interval '3 months','purchased',s.id::text,p_location_id,auth.uid(),'sale:'||s.id::text);
 return to_jsonb(s);
end; $$;
revoke all on function public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text) from public,anon,authenticated; grant execute on function public.club_glow_complete_sale(uuid,uuid,uuid,text,integer,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-16-member-catalogue-enrichment-read.sql ===
-- Member-safe enrichment read model. No operator provenance, cost or ledger data.
create or replace function public.club_list_member_supplier_enrichment(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('variantId',e.supplier_product_id,'description',e.description,'nutrition',e.nutrition,'ingredients',e.ingredients,'allergens',e.allergens,'parentImageUrl',e.parent_image_url,'variantImageUrl',e.variant_image_url)), '[]'::jsonb)
from public.club_supplier_variant_enrichment e
where e.organisation_id=p_organisation_id and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active);
$$;
revoke all on function public.club_list_member_supplier_enrichment(uuid) from public,anon;
grant execute on function public.club_list_member_supplier_enrichment(uuid) to authenticated;


-- === APPLY supabase/migrations/2026-10-17-active-sports-complete.sql ===
-- Verified catalogue metadata only. No price, supplier availability or inventory fields are stored here.
create table if not exists public.club_supplier_variant_enrichment (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
 supplier_product_id uuid not null references public.club_supplier_products(id) on delete cascade,
 description text, nutrition jsonb, ingredients text, allergens text, storage_use text,
 parent_image_url text, variant_image_url text, source_url text, source_type text, verified_at timestamptz,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organisation_id,supplier_product_id)
);
alter table public.club_supplier_variant_enrichment enable row level security;
revoke all on public.club_supplier_variant_enrichment from anon,authenticated;
-- Member-safe enrichment read model. No operator provenance, cost or ledger data.
create or replace function public.club_list_member_supplier_enrichment(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('variantId',e.supplier_product_id,'description',e.description,'nutrition',e.nutrition,'ingredients',e.ingredients,'allergens',e.allergens,'parentImageUrl',e.parent_image_url,'variantImageUrl',e.variant_image_url)), '[]'::jsonb)
from public.club_supplier_variant_enrichment e
where e.organisation_id=p_organisation_id and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active);
$$;
revoke all on function public.club_list_member_supplier_enrichment(uuid) from public,anon;
grant execute on function public.club_list_member_supplier_enrichment(uuid) to authenticated;
-- Reviewed artifact only. Apply after 2026-10-16-member-catalogue-enrichment-read.sql.
-- Extends canonical supplier offers, price history and cost history; no inventory writes.
begin;
alter table public.club_supplier_products
  add column if not exists import_identity text,
  add column if not exists trade_cost_ex_vat_minor integer check (trade_cost_ex_vat_minor between 0 and 100000000),
  add column if not exists manual_price boolean not null default false,
  add column if not exists local_product_id uuid references public.club_commerce_products(id) on delete restrict,
  add column if not exists cost_source text;
create unique index if not exists club_supplier_products_id_org_uq on public.club_supplier_products(id,organisation_id);
create unique index if not exists club_suppliers_id_org_uq on public.club_suppliers(id,organisation_id);
create unique index if not exists club_supplier_parents_id_org_uq on public.club_supplier_parent_products(id,organisation_id);
alter table public.club_supplier_products add constraint club_supplier_canonical_product_scope_fk foreign key(club_product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_products add constraint club_supplier_local_product_scope_fk foreign key(local_product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_products add constraint club_supplier_offer_supplier_scope_fk foreign key(supplier_id,organisation_id) references public.club_suppliers(id,organisation_id) on delete restrict;
alter table public.club_supplier_products add constraint club_supplier_offer_parent_scope_fk foreign key(parent_product_id,organisation_id) references public.club_supplier_parent_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_variant_costs add constraint club_supplier_cost_product_scope_fk foreign key(supplier_product_id,organisation_id) references public.club_supplier_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_variant_prices add constraint club_supplier_price_product_scope_fk foreign key(supplier_product_id,organisation_id) references public.club_supplier_products(id,organisation_id) on delete restrict;
create unique index if not exists club_supplier_import_identity_uq on public.club_supplier_products(organisation_id,supplier_id,import_identity) where import_identity is not null;
-- Keep the stable-reference and no-reference reconciliation probes bounded for full catalogues.
create index if not exists club_supplier_barcode_lookup on public.club_supplier_products(organisation_id,supplier_id,barcode) where barcode is not null;
create index if not exists club_supplier_facts_lookup on public.club_supplier_products(organisation_id,supplier_id,lower(coalesce(brand,'')),lower(name),lower(coalesce(size,'')),lower(coalesce(variant,'')),coalesce(pack_quantity,1),lower(coalesce(member_orderable_unit,'unit')));
-- Existing priced offers are conservatively treated as approved, never overwritten by cost refresh.
update public.club_supplier_products set manual_price=true where retail_price_minor is not null;
alter table public.club_supplier_variant_costs add column if not exists supplied_vat_rate numeric check (supplied_vat_rate between 0 and 1);
alter table public.club_supplier_variant_costs add column if not exists trade_cost_ex_vat_minor integer check (trade_cost_ex_vat_minor >= 0);

create or replace function public.club_supplier_commercial_sync() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare landed integer; floor_minor integer;
begin
  if new.import_identity is null then return new; end if;
  if new.trade_cost_ex_vat_minor is null or new.supplied_vat_rate is null or new.supplied_vat_rate not between 0 and 1 then raise exception 'Supplier commercial data is incomplete' using errcode='22023'; end if;
  landed:=round(new.trade_cost_ex_vat_minor*(1+new.supplied_vat_rate));
  floor_minor:=ceil(landed::numeric/70)*100;
  new.wholesale_cost_minor:=landed;
  if not new.manual_price then new.retail_price_minor:=floor_minor; end if;
  new.sellable:=new.active and not new.discontinued and new.availability_status='available' and new.retail_price_minor>0;
  return new;
end; $$;
revoke all on function public.club_supplier_commercial_sync() from public,anon,authenticated;
create trigger club_supplier_commercial_sync before insert or update on public.club_supplier_products for each row execute function public.club_supplier_commercial_sync();

create or replace function public.club_supplier_commercial_audit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.import_identity is null then return new; end if;
  if tg_op='UPDATE' and old.trade_cost_ex_vat_minor is null and old.wholesale_cost_minor is not null then
    insert into public.club_supplier_variant_costs(organisation_id,supplier_id,supplier_product_id,cost_minor,observed_at,source_reference,created_by)
    values(old.organisation_id,old.supplier_id,old.id,old.wholesale_cost_minor,old.updated_at,'Previous recorded supplier cost; VAT basis not established',auth.uid());
  end if;
  if tg_op='INSERT' or old.trade_cost_ex_vat_minor is distinct from new.trade_cost_ex_vat_minor or old.supplied_vat_rate is distinct from new.supplied_vat_rate then
    insert into public.club_supplier_variant_costs(organisation_id,supplier_id,supplier_product_id,cost_minor,trade_cost_ex_vat_minor,supplied_vat_rate,observed_at,source_reference,created_by)
    values(new.organisation_id,new.supplier_id,new.id,new.wholesale_cost_minor,new.trade_cost_ex_vat_minor,new.supplied_vat_rate,coalesce(new.availability_checked_at,now()),new.cost_source,auth.uid());
  end if;
  -- Only dedicated supplier sales units are synchronised. Local singles and their ledger stay intact.
  if new.club_product_id is not null then
    update public.club_commerce_products set sell_price_minor=new.retail_price_minor,active=new.sellable,updated_at=now()
    where id=new.club_product_id and organisation_id=new.organisation_id and not stock_tracked and cost_price_minor is null
      and (sell_price_minor is distinct from new.retail_price_minor or active is distinct from new.sellable);
  end if;
  return new;
end; $$;
revoke all on function public.club_supplier_commercial_audit() from public,anon,authenticated;
create trigger club_supplier_commercial_audit after insert or update on public.club_supplier_products for each row execute function public.club_supplier_commercial_audit();

-- This is the same importer boundary as v2 with complete validation and real reconciliation.
-- Preview makes no writes. Confirmation checks the reviewed source + current-state fingerprint.
create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; revision text; result jsonb;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; barcode_seen text[]:='{}'; batch uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- Stable SKU, then barcode, then full order-unit facts. Never trust a caller-supplied key.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),''),'barcode:'||nullif(btrim(r->>'barcode'),''),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) or (nullif(r->>'barcode','') is not null and r->>'barcode'=any(barcode_seen)) then raise exception 'Duplicate exact supplier identity' using errcode='22023'; end if;
    all_seen:=array_append(all_seen,identity_key); barcode_seen:=array_append(barcode_seen,r->>'barcode');
  end loop;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),''),'barcode:'||nullif(btrim(r->>'barcode'),''),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (nullif(r->>'supplierSku','') is not null and sp.supplier_sku=r->>'supplierSku') or (nullif(r->>'barcode','') is not null and sp.barcode=r->>'barcode') or
      ((nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode') and lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit'));
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
      values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
      on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply);
  if p_apply then
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    result:=result||jsonb_build_object('batchId',batch);
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

create or replace function public.club_set_supplier_variant_retail_price(p_organisation_id uuid,p_supplier_product_id uuid,p_retail_price_minor integer,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_supplier_products%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Pricing access required' using errcode='42501'; end if;
  if p_retail_price_minor is null or p_retail_price_minor not between 1 and 100000000 or p_active is distinct from true then raise exception 'Enter a positive GBP selling price' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into o from public.club_supplier_products where id=p_supplier_product_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Supplier variant not found' using errcode='P0002'; end if;
  if o.manual_price and o.retail_price_minor=p_retail_price_minor then return jsonb_build_object('unchanged',true); end if;
  update public.club_supplier_variant_prices set active=false,effective_to=now() where organisation_id=p_organisation_id and supplier_product_id=o.id and active;
  insert into public.club_supplier_variant_prices(organisation_id,supplier_product_id,retail_price_minor,created_by,effective_from) values(p_organisation_id,o.id,p_retail_price_minor,auth.uid(),clock_timestamp());
  update public.club_supplier_products set retail_price_minor=p_retail_price_minor,manual_price=true,updated_at=now() where id=o.id;
  return jsonb_build_object('retailPriceMinor',p_retail_price_minor,'manualPrice',true);
end; $$;
revoke all on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) from public,anon;
grant execute on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) to authenticated;

-- Keep older authorised product editors consistent with the supplier manual-price contract.
create or replace function public.club_supplier_canonical_price_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype;
begin
  select * into offer from public.club_supplier_products where organisation_id=new.organisation_id and club_product_id=new.id and import_identity is not null;
  if not found then return new; end if;
  if new.stock_tracked or new.cost_price_minor is not null then raise exception 'Use the supplier pricing controls for this sales unit' using errcode='22023'; end if;
  if offer.retail_price_minor is distinct from new.sell_price_minor then
    perform public.club_set_supplier_variant_retail_price(new.organisation_id,offer.id,new.sell_price_minor,true);
  end if;
  return new;
end; $$;
revoke all on function public.club_supplier_canonical_price_changed() from public,anon,authenticated;
create trigger club_supplier_canonical_price_changed after update of sell_price_minor,stock_tracked,cost_price_minor on public.club_commerce_products for each row execute function public.club_supplier_canonical_price_changed();

-- Imported current cost is corrected through a reviewed CSV refresh. Preserve the existing
-- history-only cost evidence API, but close its cross-organisation foreign-key gap.
create or replace function public.club_record_supplier_variant_cost(p_organisation_id uuid,p_supplier_id uuid,p_supplier_product_id uuid,p_cost_minor integer,p_currency text,p_observed_at timestamptz,p_source_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier cost access is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_supplier_products where id=p_supplier_product_id and supplier_id=p_supplier_id and organisation_id=p_organisation_id) then raise exception 'Supplier variant not found' using errcode='P0002'; end if;
  if p_cost_minor is null or p_cost_minor<0 or p_observed_at is null or p_currency is distinct from 'GBP' then raise exception 'Invalid supplier cost evidence' using errcode='22023'; end if;
  insert into public.club_supplier_variant_costs(organisation_id,supplier_id,supplier_product_id,cost_minor,currency,observed_at,source_reference,created_by) values(p_organisation_id,p_supplier_id,p_supplier_product_id,p_cost_minor,p_currency,p_observed_at,p_source_reference,auth.uid()) returning id into v_id;
  return jsonb_build_object('id',v_id);
end; $$;
revoke all on function public.club_record_supplier_variant_cost(uuid,uuid,uuid,integer,text,timestamptz,text) from public,anon;
grant execute on function public.club_record_supplier_variant_cost(uuid,uuid,uuid,integer,text,timestamptz,text) to authenticated;

create or replace function public.club_list_supplier_pricing(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Pricing access required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'club_product_id',sp.club_product_id,'supplier',s.name,'brand',sp.brand,'name',sp.name,'variant',sp.variant,'size',sp.size,'category',sp.category,'supplier_sku',sp.supplier_sku,'barcode',sp.barcode,'availability_status',sp.availability_status,'availability_checked_at',sp.availability_checked_at,'member_orderable_unit',sp.member_orderable_unit,'pack_quantity',sp.pack_quantity,'trade_cost_minor',sp.trade_cost_ex_vat_minor,'vat_rate',sp.supplied_vat_rate,'retail_price_minor',sp.retail_price_minor,'manual_price',sp.manual_price,'cost_source',sp.cost_source,
    'local_stock',coalesce((select sum(i.quantity_delta) from public.club_stock_movements i where i.organisation_id=p_organisation_id and i.product_id=coalesce(sp.local_product_id,sp.club_product_id)),0),
    'cost_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from (select c.cost_minor,c.trade_cost_ex_vat_minor,c.supplied_vat_rate,c.source_reference,c.observed_at,c.created_at from public.club_supplier_variant_costs c where c.organisation_id=p_organisation_id and c.supplier_product_id=sp.id order by c.created_at desc limit 10) h),'[]'::jsonb)) order by s.name,sp.name,sp.size,sp.variant),'[]'::jsonb) into result
  from public.club_supplier_products sp join public.club_suppliers s on s.id=sp.supplier_id and s.organisation_id=sp.organisation_id where sp.organisation_id=p_organisation_id;
  return result;
end; $$;
revoke all on function public.club_list_supplier_pricing(uuid) from public,anon;
grant execute on function public.club_list_supplier_pricing(uuid) to authenticated;

create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'localStockTracked',coalesce((select cp.stock_tracked from public.club_commerce_products cp where cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id),false),'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',sp.retail_price_minor) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active and s.member_orderable and exists(select 1 from public.club_supplier_products available where available.organisation_id=pp.organisation_id and available.parent_product_id=pp.id and available.active and available.sellable and not available.discontinued and available.availability_status='available') and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active);
$$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon; grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;


-- The order writer already locks and prices canonical products. This narrow guard
-- protects every order-item insertion, including stale baskets and direct RPC calls.
create or replace function public.club_guard_supplier_order_item() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype;
begin
  select sp.* into offer from public.club_supplier_products sp where sp.organisation_id=new.organisation_id and sp.club_product_id=new.product_id and sp.import_identity is not null for share;
  if found and (not offer.active or not offer.sellable or offer.discontinued or offer.availability_status<>'available' or not exists(select 1 from public.club_suppliers s where s.id=offer.supplier_id and s.organisation_id=new.organisation_id and s.active and s.member_orderable)) then raise exception 'This supplier option is currently unavailable' using errcode='22023'; end if;
  return new;
end; $$;
revoke all on function public.club_guard_supplier_order_item() from public,anon,authenticated;
create trigger club_guard_supplier_order_item before insert on public.club_order_items for each row execute function public.club_guard_supplier_order_item();
-- Keep generic supplier imports available while requiring the final-file gate for Active Sports.
alter function public.club_import_supplier_catalogue(uuid,text,text,jsonb) rename to club_import_supplier_catalogue_legacy_v1;
revoke all on function public.club_import_supplier_catalogue_legacy_v1(uuid,text,text,jsonb) from public,anon,authenticated;
create function public.club_import_supplier_catalogue(p_organisation_id uuid,p_supplier_name text,p_file_name text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Catalogue access required' using errcode='42501'; end if;
  if lower(btrim(p_supplier_name)) in ('active sports','active sports nutrition') then raise exception 'Use reviewed Active Sports reconciliation' using errcode='22023'; end if;
  return public.club_import_supplier_catalogue_legacy_v1(p_organisation_id,p_supplier_name,p_file_name,p_rows);
end; $$;
revoke all on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) from public,anon;
grant execute on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) to authenticated;
alter function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) rename to club_import_supplier_catalogue_legacy_v2;
revoke all on function public.club_import_supplier_catalogue_legacy_v2(uuid,text,text,jsonb,boolean) from public,anon,authenticated;
create function public.club_import_supplier_catalogue_v2(p_organisation_id uuid,p_supplier_name text,p_file_name text,p_rows jsonb,p_reconcile boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Catalogue access required' using errcode='42501'; end if;
  if lower(btrim(p_supplier_name)) in ('active sports','active sports nutrition') then raise exception 'Use reviewed Active Sports reconciliation' using errcode='22023'; end if;
  return public.club_import_supplier_catalogue_legacy_v2(p_organisation_id,p_supplier_name,p_file_name,p_rows,p_reconcile);
end; $$;
revoke all on function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) from public,anon;
grant execute on function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) to authenticated;
commit;


-- === APPLY supabase/migrations/2026-10-18-active-sports-duplicate-diagnostics.sql ===
-- Forward migration: structured duplicate diagnostics for already-migrated Active Sports databases.
-- Recreates the reconciler; do not rely on edits to the original migration.

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; revision text; result jsonb;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
      values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
      on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply);
  if p_apply then
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    result:=result||jsonb_build_object('batchId',batch);
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;


-- === APPLY supabase/migrations/2026-10-19-active-sports-identity-uniqueness.sql ===
-- Replace the legacy supplier-SKU uniqueness rule. A wholesaler may reuse a
-- SKU across brands, flavours and sizes; import_identity is the canonical key.
begin;

drop index if exists public.club_supplier_products_sku_uq;

do $$
declare duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select organisation_id, supplier_id, import_identity
    from public.club_supplier_products
    where import_identity is not null
    group by organisation_id, supplier_id, import_identity
    having count(*) > 1
  ) duplicates;
  if duplicate_count > 0 then
    raise exception 'Cannot install supplier identity uniqueness: % existing duplicate identity groups require reconciliation', duplicate_count;
  end if;
end;
$$;

create unique index if not exists club_supplier_products_identity_uq
  on public.club_supplier_products(organisation_id, supplier_id, import_identity)
  where import_identity is not null;

commit;


-- === APPLY supabase/migrations/2026-10-20-active-sports-publish-performance.sql ===
-- Forward performance migration for large Active Sports publishes.
-- Parent upserts are performed once per parent per reconciliation; business rules are unchanged.
begin;

create index if not exists club_supplier_parents_org_supplier_active_idx
  on public.club_supplier_parent_products(organisation_id, supplier_id, active, parent_key);
create index if not exists club_supplier_products_org_supplier_active_idx
  on public.club_supplier_products(organisation_id, supplier_id, active, availability_status);

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply);
  if p_apply then
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    result:=result||jsonb_build_object('batchId',batch);
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-10-21-active-sports-reconcile-profiling.sql ===
-- Forward profiling migration for the Active Sports publish RPC.
-- Emits stage timings to Supabase logs and includes them in preview/apply results.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-10-22-supplier-import-jobs.sql ===
create table if not exists public.club_import_jobs (id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade, supplier_id uuid references public.club_suppliers(id) on delete set null, filename text not null, created_by uuid not null references auth.users(id), status text not null default 'queued' check(status in ('queued','running','completed','failed')), current_stage text not null default 'import_snapshot', percentage_complete integer not null default 0 check(percentage_complete between 0 and 100), started_at timestamptz, completed_at timestamptz, failed_at timestamptz, duration_ms bigint, error_message text, reconciliation_summary jsonb not null default '{}'::jsonb, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists public.club_import_job_events (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.club_import_jobs(id) on delete cascade, stage text not null, status text not null, percentage_complete integer not null, duration_ms bigint, error_message text, created_at timestamptz not null default now());
create table if not exists public.club_import_job_logs (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.club_import_jobs(id) on delete cascade, level text not null default 'info', message text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create index if not exists club_import_jobs_org_created_idx on public.club_import_jobs(organisation_id,created_at desc);
create index if not exists club_import_jobs_status_idx on public.club_import_jobs(status,created_at);
create index if not exists club_import_job_events_job_idx on public.club_import_job_events(job_id,created_at);
create index if not exists club_import_job_logs_job_idx on public.club_import_job_logs(job_id,created_at);
create or replace function public.club_enqueue_supplier_import_job(p_organisation_id uuid,p_supplier_id uuid,p_filename text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare j public.club_import_jobs%rowtype; begin if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if; insert into public.club_import_jobs(organisation_id,supplier_id,filename,created_by,payload) values(p_organisation_id,p_supplier_id,left(coalesce(p_filename,'supplier-import.csv'),200),auth.uid(),coalesce(p_payload,'{}'::jsonb)) returning * into j; insert into public.club_import_job_events(job_id,stage,status,percentage_complete) values(j.id,'import_snapshot','started',0); return jsonb_build_object('jobId',j.id,'status',j.status,'currentStage',j.current_stage,'percentageComplete',j.percentage_complete); end; $$;
revoke all on function public.club_enqueue_supplier_import_job(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.club_enqueue_supplier_import_job(uuid,uuid,text,jsonb) to authenticated;


-- === APPLY supabase/migrations/2026-10-23-supplier-import-worker.sql ===
-- Worker entrypoints for the generic supplier import job engine.
create or replace function public.club_run_supplier_import_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.club_import_jobs%rowtype; started timestamptz:=clock_timestamp(); stage text; payload jsonb; outcome jsonb;
begin
  select * into j from public.club_import_jobs where id=p_job_id for update;
  if not found then raise exception 'Import job not found' using errcode='P0002'; end if;
  if j.status='completed' then return jsonb_build_object('jobId',j.id,'status',j.status); end if;
  update public.club_import_jobs set status='running',started_at=coalesce(started_at,now()),error_message=null where id=j.id;
  payload:=j.payload;
  foreach stage in array array['snapshot','identity_reconciliation','parent_products','supplier_variants','pricing','availability','retirement','publish','complete'] loop
    update public.club_import_jobs set current_stage=stage,percentage_complete=case stage when 'snapshot' then 5 when 'identity_reconciliation' then 15 when 'parent_products' then 30 when 'supplier_variants' then 50 when 'pricing' then 65 when 'availability' then 75 when 'retirement' then 85 when 'publish' then 95 else 100 end where id=j.id;
    insert into public.club_import_job_events(job_id,stage,status,percentage_complete) values(j.id,stage,'started',(select percentage_complete from public.club_import_jobs where id=j.id));
    if stage='publish' then
      outcome:=public.club_reconcile_active_sports(j.organisation_id,j.filename,payload->'rows',true,payload->>'revision');
    end if;
    update public.club_import_job_events set status='completed',duration_ms=extract(milliseconds from clock_timestamp()-started) where id=(select id from public.club_import_job_events where job_id=j.id and club_import_job_events.stage=stage and status='started' order by created_at desc limit 1);
  end loop;
  update public.club_import_jobs set status='completed',completed_at=now(),percentage_complete=100,current_stage='complete',duration_ms=extract(milliseconds from clock_timestamp()-started),reconciliation_summary=coalesce(outcome,'{}'::jsonb) where id=j.id;
  return jsonb_build_object('jobId',j.id,'status','completed','summary',coalesce(outcome,'{}'::jsonb));
exception when others then
  update public.club_import_jobs set status='failed',failed_at=now(),error_message=sqlerrm,duration_ms=extract(milliseconds from clock_timestamp()-started) where id=p_job_id;
  insert into public.club_import_job_logs(job_id,level,message,metadata) values(p_job_id,'error',sqlerrm,jsonb_build_object('sqlState',sqlstate));
  return jsonb_build_object('jobId',p_job_id,'status','failed','error',sqlerrm);
end; $$;
revoke all on function public.club_run_supplier_import_job(uuid) from public,anon,authenticated;

create or replace function public.club_retry_supplier_import_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.club_import_jobs%rowtype;
begin
  select * into j from public.club_import_jobs where id=p_job_id and organisation_id in (select organisation_id from public.club_import_jobs where id=p_job_id) for update;
  if not found then raise exception 'Import job not found' using errcode='P0002'; end if;
  if j.status<>'failed' then raise exception 'Only failed import jobs can be retried' using errcode='22023'; end if;
  update public.club_import_jobs set status='queued',failed_at=null,error_message=null where id=p_job_id;
  insert into public.club_import_job_logs(job_id,message) values(p_job_id,'Retry queued from failed stage',jsonb_build_object('stage',j.current_stage));
  return jsonb_build_object('jobId',p_job_id,'status','queued','currentStage',j.current_stage);
end; $$;
revoke all on function public.club_retry_supplier_import_job(uuid) from public,anon;

create or replace function public.club_get_supplier_import_job(p_job_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('job',to_jsonb(j),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.club_import_job_events e where e.job_id=j.id),'[]'::jsonb),'logs',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.club_import_job_logs l where l.job_id=j.id),'[]'::jsonb)) from public.club_import_jobs j where j.id=p_job_id and public.club_capability_allowed(j.organisation_id,auth.uid(),'supplier.catalogue_manage');
$$;
revoke all on function public.club_get_supplier_import_job(uuid) from public,anon;
grant execute on function public.club_get_supplier_import_job(uuid) to authenticated;

create or replace function public.club_list_supplier_import_jobs(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]'::jsonb) from public.club_import_jobs j where j.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage');
$$;
revoke all on function public.club_list_supplier_import_jobs(uuid) from public,anon;
grant execute on function public.club_list_supplier_import_jobs(uuid) to authenticated;


-- === APPLY supabase/migrations/2026-10-24-supplier-import-worker-trigger.sql ===
-- Atomically claim queued supplier imports for the scheduled worker.
create or replace function public.club_claim_supplier_import_jobs(p_limit integer default 1)
returns uuid[] language plpgsql security definer set search_path=pg_catalog,public as $$
declare ids uuid[];
begin
  with next_jobs as (
    select id from public.club_import_jobs where status='queued' order by created_at
    for update skip locked limit greatest(1, least(coalesce(p_limit, 1), 10))
  )
  update public.club_import_jobs j set status='running', started_at=coalesce(j.started_at, now()), current_stage='import_snapshot', percentage_complete=0
  from next_jobs n where j.id=n.id returning j.id into ids;
  return coalesce(ids, '{}'::uuid[]);
end; $$;
revoke all on function public.club_claim_supplier_import_jobs(integer) from public, anon, authenticated;
grant execute on function public.club_claim_supplier_import_jobs(integer) to service_role;


-- === APPLY supabase/migrations/2026-10-25-fix-import-job-claim-array.sql ===
-- Return the claimed UUIDs as a real array; do not assign a scalar UUID to uuid[].
create or replace function public.club_claim_supplier_import_jobs(p_limit integer default 1)
returns uuid[]
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare ids uuid[];
begin
  with next_jobs as (
    select id from public.club_import_jobs where status='queued' order by created_at
    for update skip locked limit greatest(1, least(coalesce(p_limit, 1), 10))
  ), claimed as (
    update public.club_import_jobs j
    set status='running', started_at=coalesce(j.started_at, now()), current_stage='import_snapshot', percentage_complete=0
    from next_jobs n where j.id=n.id
    returning j.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into ids from claimed;
  return ids;
end; $$;

revoke all on function public.club_claim_supplier_import_jobs(integer) from public, anon, authenticated;
grant execute on function public.club_claim_supplier_import_jobs(integer) to service_role;


-- === APPLY supabase/migrations/2026-10-26-grant-import-worker-execute.sql ===
-- The background worker uses the Supabase service-role client.
grant execute on function public.club_run_supplier_import_job(uuid) to service_role;


-- === APPLY supabase/migrations/2026-10-27-import-worker-failure-details.sql ===
-- Preserve the worker success path while returning actionable failure context.
create or replace function public.club_run_supplier_import_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.club_import_jobs%rowtype; started timestamptz:=clock_timestamp(); stage text; payload jsonb; outcome jsonb;
begin
  select * into j from public.club_import_jobs where id=p_job_id for update;
  if not found then raise exception 'Import job not found' using errcode='P0002'; end if;
  if j.status='completed' then return jsonb_build_object('jobId',j.id,'status',j.status); end if;
  update public.club_import_jobs set status='running',started_at=coalesce(started_at,now()),error_message=null where id=j.id;
  payload:=j.payload;
  foreach stage in array array['snapshot','identity_reconciliation','parent_products','supplier_variants','pricing','availability','retirement','publish','complete'] loop
    update public.club_import_jobs set current_stage=stage,percentage_complete=case stage when 'snapshot' then 5 when 'identity_reconciliation' then 15 when 'parent_products' then 30 when 'supplier_variants' then 50 when 'pricing' then 65 when 'availability' then 75 when 'retirement' then 85 when 'publish' then 95 else 100 end where id=j.id;
    insert into public.club_import_job_events(job_id,stage,status,percentage_complete) values(j.id,stage,'started',(select percentage_complete from public.club_import_jobs where id=j.id));
    if stage='publish' then outcome:=public.club_reconcile_active_sports(j.organisation_id,j.filename,payload->'rows',true,payload->>'revision'); end if;
    update public.club_import_job_events set status='completed',duration_ms=extract(milliseconds from clock_timestamp()-started) where id=(select id from public.club_import_job_events where job_id=j.id and club_import_job_events.stage=stage and status='started' order by created_at desc limit 1);
  end loop;
  update public.club_import_jobs set status='completed',completed_at=now(),percentage_complete=100,current_stage='complete',duration_ms=extract(milliseconds from clock_timestamp()-started),reconciliation_summary=coalesce(outcome,'{}'::jsonb) where id=j.id;
  return jsonb_build_object('jobId',j.id,'status','completed','summary',coalesce(outcome,'{}'::jsonb));
exception when others then
  update public.club_import_jobs set status='failed',failed_at=now(),error_message=sqlerrm,duration_ms=extract(milliseconds from clock_timestamp()-started) where id=p_job_id;
  insert into public.club_import_job_logs(job_id,level,message,metadata) values(p_job_id,'error',sqlerrm,jsonb_build_object('sqlState',sqlstate,'stage',coalesce(stage,'initialization')));
  return jsonb_build_object('jobId',p_job_id,'status','failed','stage',coalesce(stage,'initialization'),'error',sqlerrm,'sqlError',jsonb_build_object('state',sqlstate,'message',sqlerrm),'failingProductCount',0);
end; $$;

revoke all on function public.club_run_supplier_import_job(uuid) from public, anon, authenticated;
grant execute on function public.club_run_supplier_import_job(uuid) to service_role;


-- === APPLY supabase/migrations/2026-10-28-fix-worker-stage-ambiguity.sql ===
-- Qualify the stage column and PL/pgSQL stage variable in the worker event lookup.
create or replace function public.club_run_supplier_import_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
<<worker>>
declare j public.club_import_jobs%rowtype; started timestamptz:=clock_timestamp(); stage text; payload jsonb; outcome jsonb;
begin
  select * into j from public.club_import_jobs where id=p_job_id for update;
  if not found then raise exception 'Import job not found' using errcode='P0002'; end if;
  if j.status='completed' then return jsonb_build_object('jobId',j.id,'status',j.status); end if;
  update public.club_import_jobs set status='running',started_at=coalesce(started_at,now()),error_message=null where id=j.id;
  payload:=j.payload;
  foreach stage in array array['snapshot','identity_reconciliation','parent_products','supplier_variants','pricing','availability','retirement','publish','complete'] loop
    update public.club_import_jobs set current_stage=worker.stage,percentage_complete=case worker.stage when 'snapshot' then 5 when 'identity_reconciliation' then 15 when 'parent_products' then 30 when 'supplier_variants' then 50 when 'pricing' then 65 when 'availability' then 75 when 'retirement' then 85 when 'publish' then 95 else 100 end where id=j.id;
    insert into public.club_import_job_events(job_id,stage,status,percentage_complete) values(j.id,worker.stage,'started',(select percentage_complete from public.club_import_jobs where id=j.id));
    if worker.stage='publish' then outcome:=public.club_reconcile_active_sports(j.organisation_id,j.filename,payload->'rows',true,payload->>'revision'); end if;
    update public.club_import_job_events e set status='completed',duration_ms=extract(milliseconds from clock_timestamp()-started) where e.id=(select e2.id from public.club_import_job_events e2 where e2.job_id=j.id and e2.stage=worker.stage and e2.status='started' order by e2.created_at desc limit 1);
  end loop;
  update public.club_import_jobs set status='completed',completed_at=now(),percentage_complete=100,current_stage='complete',duration_ms=extract(milliseconds from clock_timestamp()-started),reconciliation_summary=coalesce(outcome,'{}'::jsonb) where id=j.id;
  return jsonb_build_object('jobId',j.id,'status','completed','summary',coalesce(outcome,'{}'::jsonb));
exception when others then
  update public.club_import_jobs set status='failed',failed_at=now(),error_message=sqlerrm,duration_ms=extract(milliseconds from clock_timestamp()-started) where id=p_job_id;
  insert into public.club_import_job_logs(job_id,level,message,metadata) values(p_job_id,'error',sqlerrm,jsonb_build_object('sqlState',sqlstate,'stage',coalesce(worker.stage,'initialization')));
  return jsonb_build_object('jobId',p_job_id,'status','failed','stage',coalesce(worker.stage,'initialization'),'error',sqlerrm,'sqlError',jsonb_build_object('state',sqlstate,'message',sqlerrm),'failingProductCount',0);
end; $$;

revoke all on function public.club_run_supplier_import_job(uuid) from public, anon, authenticated;
grant execute on function public.club_run_supplier_import_job(uuid) to service_role;


-- === APPLY supabase/migrations/2026-10-29-worker-reconcile-service-role.sql ===
-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-10-30-stage-supplier-products.sql ===
-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  create temporary table worker_supplier_products on commit drop as select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id;
  create index worker_supplier_products_identity_idx on worker_supplier_products(import_identity);
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from worker_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-10-31-reconcile-stage-logging.sql ===
-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  import_job_id uuid;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select id into import_job_id from public.club_import_jobs where organisation_id=p_organisation_id and filename=p_file_name and status='running' order by created_at desc limit 1;
  create temporary table worker_supplier_products on commit drop as select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id;
  create index worker_supplier_products_identity_idx on worker_supplier_products(import_identity);
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'snapshot complete',jsonb_build_object('elapsedMs',timings->'csvLoadMs')); end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'identity matching complete',jsonb_build_object('elapsedMs',timings->'validationMs')); insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'duplicate handling complete',jsonb_build_object('elapsedMs',timings->'validationMs')); end if;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from worker_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'reconciliation complete',jsonb_build_object('elapsedMs',timings->'supplierProductUpsertMs')); end if;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'pricing complete',jsonb_build_object('elapsedMs',timings->'availabilityRetirementMs')); end if;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'publish complete',jsonb_build_object('elapsedMs',timings->'publicationMs')); end if;
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-11-01-reconcile-statement-timings.sql ===
-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  import_job_id uuid; stmt_started timestamptz;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select id into import_job_id from public.club_import_jobs where organisation_id=p_organisation_id and filename=p_file_name and status='running' order by created_at desc limit 1;
  stmt_started:=clock_timestamp();
  create temporary table worker_supplier_products on commit drop as select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id;
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','stage supplier products','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  stmt_started:=clock_timestamp();
  create index worker_supplier_products_identity_idx on worker_supplier_products(import_identity);
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','index staged supplier identity','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'snapshot complete',jsonb_build_object('elapsedMs',timings->'csvLoadMs')); end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'identity matching complete',jsonb_build_object('elapsedMs',timings->'validationMs')); insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'duplicate handling complete',jsonb_build_object('elapsedMs',timings->'validationMs')); end if;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    stmt_started:=clock_timestamp();
    select array_agg(sp.id) into match_ids from worker_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','supplier identity match','row',source_row,'elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    stmt_started:=clock_timestamp();
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','prior supplier projection','row',source_row,'elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'reconciliation complete',jsonb_build_object('elapsedMs',timings->'supplierProductUpsertMs')); end if;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'pricing complete',jsonb_build_object('elapsedMs',timings->'availabilityRetirementMs')); end if;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'publish complete',jsonb_build_object('elapsedMs',timings->'publicationMs')); end if;
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-11-02-reduce-statement-timing-volume.sql ===
-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  import_job_id uuid; stmt_started timestamptz; match_logged boolean:=false; prior_logged boolean:=false;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select id into import_job_id from public.club_import_jobs where organisation_id=p_organisation_id and filename=p_file_name and status='running' order by created_at desc limit 1;
  stmt_started:=clock_timestamp();
  create temporary table worker_supplier_products on commit drop as select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id;
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','stage supplier products','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  stmt_started:=clock_timestamp();
  create index worker_supplier_products_identity_idx on worker_supplier_products(import_identity);
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','index staged supplier identity','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'snapshot complete',jsonb_build_object('elapsedMs',timings->'csvLoadMs')); end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'identity matching complete',jsonb_build_object('elapsedMs',timings->'validationMs')); insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'duplicate handling complete',jsonb_build_object('elapsedMs',timings->'validationMs')); end if;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    stmt_started:=clock_timestamp();
    select array_agg(sp.id) into match_ids from worker_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if import_job_id is not null and not match_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','supplier identity match','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); match_logged:=true; end if;
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    stmt_started:=clock_timestamp();
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if import_job_id is not null and not prior_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','prior supplier projection','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); prior_logged:=true; end if;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'reconciliation complete',jsonb_build_object('elapsedMs',timings->'supplierProductUpsertMs')); end if;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'pricing complete',jsonb_build_object('elapsedMs',timings->'availabilityRetirementMs')); end if;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'publish complete',jsonb_build_object('elapsedMs',timings->'publicationMs')); end if;
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-11-03-reconcile-remaining-statement-timings.sql ===
-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  import_job_id uuid; stmt_started timestamptz; match_logged boolean:=false; prior_logged boolean:=false; parent_logged boolean:=false; variant_logged boolean:=false; commerce_logged boolean:=false; availability_logged boolean:=false; publication_logged boolean:=false;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select id into import_job_id from public.club_import_jobs where organisation_id=p_organisation_id and filename=p_file_name and status='running' order by created_at desc limit 1;
  stmt_started:=clock_timestamp();
  create temporary table worker_supplier_products on commit drop as select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id;
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','stage supplier products','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  stmt_started:=clock_timestamp();
  create index worker_supplier_products_identity_idx on worker_supplier_products(import_identity);
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','index staged supplier identity','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'snapshot complete',jsonb_build_object('elapsedMs',timings->'csvLoadMs')); end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'identity matching complete',jsonb_build_object('elapsedMs',timings->'validationMs')); insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'duplicate handling complete',jsonb_build_object('elapsedMs',timings->'validationMs')); end if;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    stmt_started:=clock_timestamp();
    select array_agg(sp.id) into match_ids from worker_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if import_job_id is not null and not match_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','supplier identity match','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); match_logged:=true; end if;
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    stmt_started:=clock_timestamp();
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if import_job_id is not null and not prior_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','prior supplier projection','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); prior_logged:=true; end if;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      if not parent_logged then stmt_started:=clock_timestamp(); end if;
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
      if import_job_id is not null and not parent_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','parent product upsert','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); parent_logged:=true; end if;
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      if not variant_logged then stmt_started:=clock_timestamp(); end if;
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      if not variant_logged then stmt_started:=clock_timestamp(); end if;
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if import_job_id is not null and not variant_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','supplier variant insert or update','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); variant_logged:=true; end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      if not commerce_logged then stmt_started:=clock_timestamp(); end if;
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
      if import_job_id is not null and not commerce_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','commerce product lookup or creation','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); commerce_logged:=true; end if;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'reconciliation complete',jsonb_build_object('elapsedMs',timings->'supplierProductUpsertMs')); end if;
  if not availability_logged then stmt_started:=clock_timestamp(); end if;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  if import_job_id is not null and not availability_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','availability and retirement queries','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); availability_logged:=true; end if;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'pricing complete',jsonb_build_object('elapsedMs',timings->'availabilityRetirementMs')); end if;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp(); stmt_started:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'publish complete',jsonb_build_object('elapsedMs',timings->'publicationMs')); end if;
    if import_job_id is not null and not publication_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','publication updates','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); publication_logged:=true; end if;
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-11-04-post-reconciliation-timings.sql ===
-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  import_job_id uuid; stmt_started timestamptz; match_logged boolean:=false; prior_logged boolean:=false; parent_logged boolean:=false; variant_logged boolean:=false; commerce_logged boolean:=false; availability_logged boolean:=false; publication_logged boolean:=false;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select id into import_job_id from public.club_import_jobs where organisation_id=p_organisation_id and filename=p_file_name and status='running' order by created_at desc limit 1;
  stmt_started:=clock_timestamp();
  create temporary table worker_supplier_products on commit drop as select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id;
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','stage supplier products','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  stmt_started:=clock_timestamp();
  create index worker_supplier_products_identity_idx on worker_supplier_products(import_identity);
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','index staged supplier identity','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'snapshot complete',jsonb_build_object('elapsedMs',timings->'csvLoadMs')); end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'identity matching complete',jsonb_build_object('elapsedMs',timings->'validationMs')); insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'duplicate handling complete',jsonb_build_object('elapsedMs',timings->'validationMs')); end if;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    stmt_started:=clock_timestamp();
    select array_agg(sp.id) into match_ids from worker_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if import_job_id is not null and not match_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','supplier identity match','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); match_logged:=true; end if;
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    stmt_started:=clock_timestamp();
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if import_job_id is not null and not prior_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','prior supplier projection','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); prior_logged:=true; end if;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      if not parent_logged then stmt_started:=clock_timestamp(); end if;
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
      if import_job_id is not null and not parent_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','parent product upsert','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); parent_logged:=true; end if;
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      if not variant_logged then stmt_started:=clock_timestamp(); end if;
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      if not variant_logged then stmt_started:=clock_timestamp(); end if;
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if import_job_id is not null and not variant_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','supplier variant insert or update','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); variant_logged:=true; end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      if not commerce_logged then stmt_started:=clock_timestamp(); end if;
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
      if import_job_id is not null and not commerce_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','commerce product lookup or creation','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); commerce_logged:=true; end if;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'reconciliation complete',jsonb_build_object('elapsedMs',timings->'supplierProductUpsertMs')); end if;
  if not availability_logged then stmt_started:=clock_timestamp(); end if;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  if import_job_id is not null and not availability_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','availability and retirement queries','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); availability_logged:=true; end if;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'pricing complete',jsonb_build_object('elapsedMs',timings->'availabilityRetirementMs')); end if;
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'post-reconciliation result construction started','{}'::jsonb); end if;
  stmt_started:=clock_timestamp();
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'post-reconciliation result construction complete',jsonb_build_object('elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  if p_apply then
    stage_at:=clock_timestamp(); stmt_started:=clock_timestamp();
    stmt_started:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'retire unavailable supplier variants complete',jsonb_build_object('elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    stmt_started:=clock_timestamp();
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'retire unavailable parent products complete',jsonb_build_object('elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    stmt_started:=clock_timestamp();
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'supplier publication flag update complete',jsonb_build_object('elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    stmt_started:=clock_timestamp();
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'supplier import batch insert complete',jsonb_build_object('elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'publish complete',jsonb_build_object('elapsedMs',timings->'publicationMs')); end if;
    if import_job_id is not null and not publication_logged then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','publication updates','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); publication_logged:=true; end if;
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'reconciliation function return reached',jsonb_build_object('elapsedMs',extract(milliseconds from clock_timestamp()-started_at))); end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;


-- === APPLY supabase/migrations/2026-11-07-remove-active-sports-reconciliation-guard.sql ===
create or replace function public.club_import_supplier_catalogue_v2(
  p_organisation_id uuid,
  p_supplier_name text,
  p_file_name text,
  p_rows jsonb,
  p_reconcile boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_supplier public.club_suppliers%rowtype;
  v_parent public.club_supplier_parent_products%rowtype;
  v_offer public.club_supplier_products%rowtype;
  v_row jsonb;
  v_parent_key text;
  v_created integer := 0;
  v_updated integer := 0;
  v_invalid integer := 0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'supplier.catalogue_manage') then
    raise exception 'Supplier catalogue import is not permitted' using errcode='42501';
  end if;
  if p_organisation_id is null or nullif(btrim(p_supplier_name), '') is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Invalid supplier import' using errcode='22023';
  end if;
  insert into public.club_suppliers(organisation_id, name, slug, member_orderable)
  values (p_organisation_id, btrim(p_supplier_name), lower(regexp_replace(btrim(p_supplier_name), '[^a-z0-9]+', '-', 'g')), false)
  on conflict (organisation_id, lower(name)) do update set active=true, updated_at=now()
  returning * into v_supplier;
  insert into public.club_supplier_import_batches(organisation_id, supplier_id, file_name, imported_by, row_count)
  values (p_organisation_id, v_supplier.id, coalesce(nullif(btrim(p_file_name), ''), 'supplier.csv'), auth.uid(), jsonb_array_length(p_rows));
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if nullif(btrim(v_row->>'name'), '') is null then v_invalid := v_invalid + 1; continue; end if;
    v_parent_key := coalesce(nullif(btrim(v_row->>'parentKey'), ''), lower(btrim(v_row->>'name')));
    insert into public.club_supplier_parent_products(organisation_id, supplier_id, parent_key, brand, name, description, category, subcategory, source_url, parent_image_url)
    values (p_organisation_id, v_supplier.id, v_parent_key, nullif(btrim(v_row->>'brand'), ''), btrim(v_row->>'name'), nullif(v_row->>'description', ''), nullif(btrim(v_row->>'category'), ''), nullif(btrim(v_row->>'subcategory'), ''), nullif(v_row->>'sourceUrl', ''), nullif(v_row->>'parentImageUrl', ''))
    on conflict (organisation_id, supplier_id, parent_key) do update set brand=excluded.brand, name=excluded.name, description=excluded.description, category=excluded.category, subcategory=excluded.subcategory, source_url=excluded.source_url, parent_image_url=excluded.parent_image_url, updated_at=now()
    returning * into v_parent;
    select * into v_offer from public.club_supplier_products
    where organisation_id=p_organisation_id and supplier_id=v_supplier.id
      and ((nullif(btrim(v_row->>'supplierSku'), '') is not null and supplier_sku=btrim(v_row->>'supplierSku'))
        or (supplier_sku is null and parent_product_id=v_parent.id and coalesce(variant, '')=coalesce(nullif(btrim(v_row->>'flavour'), ''), '') and coalesce(size, '')=coalesce(nullif(btrim(v_row->>'size'), ''), '')))
    limit 1;
    if v_offer.id is null then
      insert into public.club_supplier_products(organisation_id, supplier_id, parent_product_id, supplier_sku, barcode, brand, name, variant, size, pack_quantity, member_orderable_unit, description, category, source_url, image_url, variant_image_url, availability_status, availability_checked_at, trade_cost_ex_vat_minor, supplied_vat_rate, discontinued, source_metadata)
      values (p_organisation_id, v_supplier.id, v_parent.id, nullif(btrim(v_row->>'supplierSku'), ''), nullif(btrim(v_row->>'barcode'), ''), nullif(btrim(v_row->>'brand'), ''), v_parent.name, nullif(btrim(v_row->>'flavour'), ''), nullif(btrim(v_row->>'size'), ''), nullif(v_row->>'packQuantity', '')::integer, nullif(btrim(v_row->>'memberOrderableUnit'), ''), nullif(v_row->>'description', ''), nullif(btrim(v_row->>'category'), ''), nullif(v_row->>'sourceUrl', ''), nullif(v_row->>'variantImageUrl', ''), nullif(v_row->>'variantImageUrl', ''), coalesce(nullif(v_row->>'availabilityStatus', ''), 'unknown'), nullif(v_row->>'availabilityCheckedAt', '')::timestamptz, nullif(v_row->>'tradeCostExVatMinor', '')::integer, nullif(v_row->>'suppliedVatRate', '')::numeric, coalesce((v_row->>'discontinued')::boolean, false), jsonb_build_object('parent_key', v_parent_key, 'notes', v_row->>'notes'))
      returning * into v_offer;
      v_created := v_created + 1;
    else
      update public.club_supplier_products set parent_product_id=v_parent.id, brand=nullif(btrim(v_row->>'brand'), ''), name=v_parent.name, variant=nullif(btrim(v_row->>'flavour'), ''), size=nullif(btrim(v_row->>'size'), ''), pack_quantity=nullif(v_row->>'packQuantity', '')::integer, member_orderable_unit=nullif(btrim(v_row->>'memberOrderableUnit'), ''), description=nullif(v_row->>'description', ''), category=nullif(btrim(v_row->>'category'), ''), source_url=nullif(v_row->>'sourceUrl', ''), variant_image_url=nullif(v_row->>'variantImageUrl', ''), availability_status=coalesce(nullif(v_row->>'availabilityStatus', ''), 'unknown'), availability_checked_at=nullif(v_row->>'availabilityCheckedAt', '')::timestamptz, trade_cost_ex_vat_minor=nullif(v_row->>'tradeCostExVatMinor', '')::integer, supplied_vat_rate=nullif(v_row->>'suppliedVatRate', '')::numeric, discontinued=coalesce((v_row->>'discontinued')::boolean, false), updated_at=now() where id=v_offer.id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('supplierId', v_supplier.id, 'created', v_created, 'updated', v_updated, 'invalid', v_invalid, 'reconciled', p_reconcile);
end;
$$;
revoke all on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) to authenticated;


-- === APPLY supabase/migrations/2026-11-08-link-supplier-catalogue-to-commerce.sql ===
-- Promote imported supplier variants into the existing sellable catalogue.
create or replace function public.club_link_supplier_catalogue_to_commerce(p_organisation_id uuid, p_supplier_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; pp public.club_supplier_parent_products%rowtype; sp public.club_supplier_products%rowtype; f public.club_product_families%rowtype; cp public.club_commerce_products%rowtype; v_price integer; v_created integer:=0; v_updated integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier catalogue import is not permitted' using errcode='42501'; end if;
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name)=lower(btrim(p_supplier_name)) limit 1;
  if not found then return jsonb_build_object('created',0,'updated',0); end if;
  for pp in select * from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and archived_at is null loop
    insert into public.club_product_families(organisation_id,name,brand,description,category,media,active)
    values(p_organisation_id,pp.name,pp.brand,pp.description,pp.category,case when pp.parent_image_url is null then null else jsonb_build_object('url',pp.parent_image_url) end,true)
    on conflict (organisation_id,name) do update set brand=coalesce(excluded.brand,club_product_families.brand),description=coalesce(excluded.description,club_product_families.description),media=coalesce(excluded.media,club_product_families.media),updated_at=now()
    returning * into f;
    for sp in select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and parent_product_id=pp.id and not discontinued loop
      v_price:=case when sp.trade_cost_ex_vat_minor is not null then ceil((sp.trade_cost_ex_vat_minor*(1+coalesce(sp.supplied_vat_rate,0.2)))/0.70)::integer else 0 end;
      select * into cp from public.club_commerce_products where organisation_id=p_organisation_id and supplier_reference='supplier_product:'||sp.id::text limit 1;
      if found then
        update public.club_commerce_products set family_id=f.id,variant_options=jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit),description=coalesce(sp.description,club_commerce_products.description),media=case when sp.variant_image_url is null then media else jsonb_build_object('url',sp.variant_image_url) end,active=not sp.discontinued,updated_at=now(),sell_price_minor=case when sell_price_minor=0 then v_price else sell_price_minor end where id=cp.id;
        v_updated:=v_updated+1;
      else
        insert into public.club_commerce_products(organisation_id,sku,barcode,name,brand,description,category,active,stock_tracked,sell_price_minor,cost_price_minor,currency,supplier_reference,media,family_id,variant_options)
        values(p_organisation_id,case when sp.supplier_sku is not null and not exists(select 1 from public.club_commerce_products x where x.organisation_id=p_organisation_id and x.sku=sp.supplier_sku) then sp.supplier_sku else null end,sp.barcode,pp.name,pp.brand,sp.description,pp.category,not sp.discontinued,false,v_price,sp.trade_cost_ex_vat_minor,'GBP','supplier_product:'||sp.id::text,case when sp.variant_image_url is null then null else jsonb_build_object('url',sp.variant_image_url) end,f.id,jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit)) returning * into cp;
        v_created:=v_created+1;
      end if;
      update public.club_supplier_products set club_product_id=cp.id where id=sp.id and club_product_id is distinct from cp.id;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'updated',v_updated);
end; $$;
revoke all on function public.club_link_supplier_catalogue_to_commerce(uuid,text) from public,anon;
grant execute on function public.club_link_supplier_catalogue_to_commerce(uuid,text) to authenticated;


-- === APPLY supabase/migrations/2026-11-09-fix-active-sports-retail-rounding.sql ===
-- Keep supplier-derived default retail prices aligned with R12's whole-pound pricing rule.
create or replace function public.club_link_supplier_catalogue_to_commerce(p_organisation_id uuid, p_supplier_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; pp public.club_supplier_parent_products%rowtype; sp public.club_supplier_products%rowtype; f public.club_product_families%rowtype; cp public.club_commerce_products%rowtype; v_price integer; v_created integer:=0; v_updated integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier catalogue import is not permitted' using errcode='42501'; end if;
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name)=lower(btrim(p_supplier_name)) limit 1;
  if not found then return jsonb_build_object('created',0,'updated',0); end if;
  for pp in select * from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and archived_at is null loop
    insert into public.club_product_families(organisation_id,name,brand,description,category,media,active)
    values(p_organisation_id,pp.name,pp.brand,pp.description,pp.category,case when pp.parent_image_url is null then null else jsonb_build_object('url',pp.parent_image_url) end,true)
    on conflict (organisation_id,name) do update set brand=coalesce(excluded.brand,club_product_families.brand),description=coalesce(excluded.description,club_product_families.description),media=coalesce(excluded.media,club_product_families.media),updated_at=now()
    returning * into f;
    for sp in select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and parent_product_id=pp.id and not discontinued loop
      v_price:=case when sp.trade_cost_ex_vat_minor is not null then ceil(round(sp.trade_cost_ex_vat_minor*(1+coalesce(sp.supplied_vat_rate,0.2)))/70.0)*100 else 0 end;
      select * into cp from public.club_commerce_products where organisation_id=p_organisation_id and supplier_reference='supplier_product:'||sp.id::text limit 1;
      if found then
        update public.club_commerce_products set family_id=f.id,variant_options=jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit),description=coalesce(sp.description,club_commerce_products.description),media=case when sp.variant_image_url is null then media else jsonb_build_object('url',sp.variant_image_url) end,active=not sp.discontinued,updated_at=now(),sell_price_minor=case when sell_price_minor=0 then v_price else sell_price_minor end where id=cp.id;
        v_updated:=v_updated+1;
      else
        insert into public.club_commerce_products(organisation_id,sku,barcode,name,brand,description,category,active,stock_tracked,sell_price_minor,cost_price_minor,currency,supplier_reference,media,family_id,variant_options)
        values(p_organisation_id,case when sp.supplier_sku is not null and not exists(select 1 from public.club_commerce_products x where x.organisation_id=p_organisation_id and x.sku=sp.supplier_sku) then sp.supplier_sku else null end,sp.barcode,pp.name,pp.brand,sp.description,pp.category,not sp.discontinued,false,v_price,sp.trade_cost_ex_vat_minor,'GBP','supplier_product:'||sp.id::text,case when sp.variant_image_url is null then null else jsonb_build_object('url',sp.variant_image_url) end,f.id,jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit)) returning * into cp;
        v_created:=v_created+1;
      end if;
      update public.club_supplier_products set club_product_id=cp.id where id=sp.id and club_product_id is distinct from cp.id;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'updated',v_updated);
end; $$;
revoke all on function public.club_link_supplier_catalogue_to_commerce(uuid,text) from public,anon;
grant execute on function public.club_link_supplier_catalogue_to_commerce(uuid,text) to authenticated;


-- === APPLY supabase/migrations/2026-11-12-active-sports-set-based-import.sql ===
-- Set-based replacement for the direct supplier catalogue importer.
-- The public contract is unchanged; rows are staged once and reconciled in bulk.
create or replace function public.club_import_supplier_catalogue_v2(
  p_organisation_id uuid,
  p_supplier_name text,
  p_file_name text,
  p_rows jsonb,
  p_reconcile boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_supplier public.club_suppliers%rowtype;
  v_batch uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_invalid integer := 0;
  v_rows integer := 0;
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'supplier.catalogue_manage') then
    raise exception 'Supplier catalogue import is not permitted' using errcode='42501';
  end if;
  if p_organisation_id is null or nullif(btrim(p_supplier_name), '') is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Invalid supplier import' using errcode='22023';
  end if;

  insert into public.club_suppliers(organisation_id, name, slug, member_orderable)
  values (p_organisation_id, btrim(p_supplier_name), lower(regexp_replace(btrim(p_supplier_name), '[^a-z0-9]+', '-', 'g')), false)
  on conflict (organisation_id, lower(name)) do update set active=true, updated_at=v_now
  returning * into v_supplier;

  insert into public.club_supplier_import_batches(organisation_id, supplier_id, file_name, imported_by, row_count)
  values (p_organisation_id, v_supplier.id, coalesce(nullif(btrim(p_file_name), ''), 'supplier.csv'), auth.uid(), jsonb_array_length(p_rows))
  returning id into v_batch;

  drop table if exists pg_temp._active_sports_rows;
  drop table if exists pg_temp._active_sports_valid;
  drop table if exists pg_temp._active_sports_resolved;
  drop table if exists pg_temp._active_sports_matches;

  create temporary table _active_sports_rows on commit drop as
  select
    e.ordinal::integer as row_no,
    nullif(btrim(x->>'name'), '') as name,
    nullif(btrim(x->>'brand'), '') as brand,
    nullif(btrim(x->>'parentKey'), '') as supplied_parent_key,
    nullif(btrim(x->>'flavour'), '') as variant,
    nullif(btrim(x->>'size'), '') as size,
    nullif(btrim(x->>'category'), '') as category,
    nullif(btrim(x->>'subcategory'), '') as subcategory,
    nullif(x->>'description', '') as description,
    nullif(btrim(x->>'supplierSku'), '') as supplier_sku,
    nullif(btrim(x->>'barcode'), '') as barcode,
    case when coalesce(x->>'packQuantity','') ~ '^\d+$' then (x->>'packQuantity')::integer else null end as pack_quantity,
    nullif(btrim(x->>'memberOrderableUnit'), '') as member_orderable_unit,
    nullif(btrim(x->>'sourceUrl'), '') as source_url,
    nullif(btrim(x->>'parentImageUrl'), '') as parent_image_url,
    nullif(btrim(x->>'variantImageUrl'), '') as variant_image_url,
    coalesce(nullif(btrim(x->>'availabilityStatus'), ''), 'unknown') as availability_status,
    case when nullif(x->>'availabilityCheckedAt','') is null then null else (x->>'availabilityCheckedAt')::timestamptz end as availability_checked_at,
    case when coalesce(x->>'tradeCostExVatMinor','') ~ '^\d+$' then (x->>'tradeCostExVatMinor')::integer else null end as trade_cost_ex_vat_minor,
    case when coalesce(x->>'suppliedVatRate','') ~ '^\d+(\.\d+)?$' then (x->>'suppliedVatRate')::numeric else null end as supplied_vat_rate,
    coalesce((x->>'discontinued')::boolean, false) as discontinued,
    nullif(x->>'notes', '') as notes
  from jsonb_array_elements(p_rows) with ordinality as e(x, ordinal);

  select count(*) into v_rows from _active_sports_rows;
  select count(*) into v_invalid from _active_sports_rows where name is null;

  -- Keep the first row for an exact canonical identity, matching the existing import semantics.
  create temporary table _active_sports_valid on commit drop as
  select distinct on (q.identity_key) q.*
  from (
    select r.*,
      coalesce(r.supplied_parent_key, lower(r.name)) as parent_key,
      'import:' || md5(lower(coalesce(r.brand,'')) || '|' || lower(r.name) || '|' || lower(coalesce(r.variant,'')) || '|' || lower(coalesce(r.size,'')) || '|' || coalesce(r.pack_quantity,1)::text || '|' || lower(coalesce(r.member_orderable_unit,'unit'))) as identity_key
    from _active_sports_rows r
    where r.name is not null
  ) q
  order by q.identity_key, q.row_no;

  -- Parent families are upserted once per identity, rather than once per input row.
  insert into public.club_supplier_parent_products(
    organisation_id, supplier_id, parent_key, brand, name, description, category, subcategory, source_url, parent_image_url
  )
  select distinct on (parent_key)
    p_organisation_id, v_supplier.id,
    parent_key, brand, name, description, category, subcategory, source_url, parent_image_url
  from _active_sports_valid
  order by parent_key, row_no
  on conflict (organisation_id, supplier_id, parent_key) do update set
    brand=excluded.brand,
    name=excluded.name,
    description=excluded.description,
    category=excluded.category,
    subcategory=excluded.subcategory,
    source_url=excluded.source_url,
    parent_image_url=excluded.parent_image_url,
    updated_at=v_now;

  create temporary table _active_sports_resolved on commit drop as
  select r.*, pp.id as parent_product_id
  from _active_sports_valid r
  join public.club_supplier_parent_products pp
    on pp.organisation_id=p_organisation_id
   and pp.supplier_id=v_supplier.id
   and pp.parent_key=r.parent_key;

  create temporary table _active_sports_matches on commit drop as
  select distinct on (r.identity_key)
    r.identity_key, r.parent_product_id, sp.id as supplier_product_id
  from _active_sports_resolved r
  left join public.club_supplier_products sp
    on sp.organisation_id=p_organisation_id
   and sp.supplier_id=v_supplier.id
   and (
     sp.import_identity=r.identity_key
     or (
       sp.import_identity is null
       and sp.parent_product_id=r.parent_product_id
       and lower(coalesce(sp.brand,''))=lower(coalesce(r.brand,''))
       and lower(sp.name)=lower(r.name)
       and lower(coalesce(sp.variant,''))=lower(coalesce(r.variant,''))
       and lower(coalesce(sp.size,''))=lower(coalesce(r.size,''))
       and coalesce(sp.pack_quantity,1)=coalesce(r.pack_quantity,1)
       and lower(coalesce(sp.member_orderable_unit,'unit'))=lower(coalesce(r.member_orderable_unit,'unit'))
     )
   )
  order by r.identity_key, (sp.import_identity=r.identity_key) desc nulls last, sp.created_at, sp.id;

  update public.club_supplier_products sp
  set parent_product_id=r.parent_product_id,
      import_identity=r.identity_key,
      supplier_sku=r.supplier_sku,
      barcode=r.barcode,
      brand=r.brand,
      name=r.name,
      variant=r.variant,
      size=r.size,
      pack_quantity=r.pack_quantity,
      member_orderable_unit=r.member_orderable_unit,
      description=r.description,
      category=r.category,
      source_url=r.source_url,
      variant_image_url=r.variant_image_url,
      availability_status=r.availability_status,
      availability_checked_at=r.availability_checked_at,
      trade_cost_ex_vat_minor=r.trade_cost_ex_vat_minor,
      supplied_vat_rate=r.supplied_vat_rate,
      discontinued=r.discontinued,
      source_metadata=jsonb_build_object('parent_key',r.parent_key,'notes',r.notes),
      active=true,
      archived_at=null,
      updated_at=v_now
  from _active_sports_resolved r
  join _active_sports_matches m on m.identity_key=r.identity_key and m.supplier_product_id=sp.id;
  get diagnostics v_updated = row_count;

  insert into public.club_supplier_products(
    organisation_id, supplier_id, parent_product_id, import_identity, supplier_sku, barcode, brand, name, variant, size,
    pack_quantity, member_orderable_unit, description, category, source_url, image_url, variant_image_url,
    availability_status, availability_checked_at, trade_cost_ex_vat_minor, supplied_vat_rate, discontinued, source_metadata
  )
  select
    p_organisation_id, v_supplier.id, r.parent_product_id, r.identity_key, r.supplier_sku, r.barcode, r.brand, r.name, r.variant, r.size,
    r.pack_quantity, r.member_orderable_unit, r.description, r.category, r.source_url, r.variant_image_url, r.variant_image_url,
    r.availability_status, r.availability_checked_at, r.trade_cost_ex_vat_minor, r.supplied_vat_rate, r.discontinued,
    jsonb_build_object('parent_key',r.parent_key,'notes',r.notes)
  from _active_sports_resolved r
  left join _active_sports_matches m on m.identity_key=r.identity_key
  where m.supplier_product_id is null;
  get diagnostics v_created = row_count;

  update public.club_supplier_import_batches
  set created_count=v_created, updated_count=v_updated, invalid_count=v_invalid, skipped_count=(v_rows-v_invalid-v_created-v_updated)
  where id=v_batch;

  return jsonb_build_object(
    'supplierId', v_supplier.id,
    'batchId', v_batch,
    'created', v_created,
    'updated', v_updated,
    'invalid', v_invalid,
    'reconciled', p_reconcile
  );
end;
$$;
revoke all on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.club_import_supplier_catalogue_v2(uuid, text, text, jsonb, boolean) to authenticated;


-- === APPLY supabase/migrations/2026-11-14-active-sports-image-sync.sql ===
-- Supplier-managed Active Sports imagery must refresh existing linked
-- commerce rows when a corrected parent/variant image is imported.
create or replace function public.club_link_supplier_catalogue_to_commerce(p_organisation_id uuid, p_supplier_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; pp public.club_supplier_parent_products%rowtype; sp public.club_supplier_products%rowtype; f public.club_product_families%rowtype; cp public.club_commerce_products%rowtype; v_price integer:=0; v_created integer:=0; v_updated integer:=0; v_image text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier catalogue import is not permitted' using errcode='42501'; end if;
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name)=lower(btrim(p_supplier_name)) limit 1;
  if not found then return jsonb_build_object('created',0,'updated',0); end if;
  for pp in select * from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and archived_at is null loop
    v_image:=case when coalesce(nullif(btrim(pp.parent_image_url),''),'') ~* '^https?://' then btrim(pp.parent_image_url) else null end;
    insert into public.club_product_families(organisation_id,name,brand,description,category,media,active)
    values(p_organisation_id,pp.name,pp.brand,pp.description,pp.category,case when v_image is null then null else jsonb_build_object('url',v_image) end,true)
    on conflict (organisation_id,name) do update set brand=coalesce(excluded.brand,club_product_families.brand),description=coalesce(excluded.description,club_product_families.description),media=coalesce(excluded.media,club_product_families.media),updated_at=now()
    returning * into f;
    for sp in select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and parent_product_id=pp.id and not discontinued loop
      v_price:=case when sp.trade_cost_ex_vat_minor is not null then ceil(round(sp.trade_cost_ex_vat_minor*(1+coalesce(sp.supplied_vat_rate,0.2)))/70.0)*100 else 0 end;
      v_image:=case
        when coalesce(nullif(btrim(sp.variant_image_url),''), nullif(btrim(pp.parent_image_url),'')) ~* '^https?://'
          then coalesce(nullif(btrim(sp.variant_image_url),''), nullif(btrim(pp.parent_image_url),''))
        else null
      end;
      select * into cp from public.club_commerce_products where organisation_id=p_organisation_id and supplier_reference='supplier_product:'||sp.id::text limit 1;
      if found then
        update public.club_commerce_products
        set family_id=f.id,variant_options=jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit),description=coalesce(sp.description,club_commerce_products.description),media=case when v_image is null then media else jsonb_build_object('url',v_image) end,active=not sp.discontinued,updated_at=now(),sell_price_minor=case when not sp.manual_price then v_price else sell_price_minor end
        where id=cp.id;
        v_updated:=v_updated+1;
      else
        insert into public.club_commerce_products(organisation_id,sku,barcode,name,brand,description,category,active,stock_tracked,sell_price_minor,cost_price_minor,currency,supplier_reference,media,family_id,variant_options)
        values(p_organisation_id,case when sp.supplier_sku is not null and not exists(select 1 from public.club_commerce_products x where x.organisation_id=p_organisation_id and x.sku=sp.supplier_sku) then sp.supplier_sku else null end,sp.barcode,pp.name,pp.brand,sp.description,pp.category,not sp.discontinued,false,v_price,sp.trade_cost_ex_vat_minor,'GBP','supplier_product:'||sp.id::text,case when v_image is null then null else jsonb_build_object('url',v_image) end,f.id,jsonb_build_object('size',sp.size,'flavour',sp.variant,'packQuantity',sp.pack_quantity,'orderUnit',sp.member_orderable_unit)) returning * into cp;
        v_created:=v_created+1;
      end if;
      update public.club_supplier_products set club_product_id=cp.id where id=sp.id and club_product_id is distinct from cp.id;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'updated',v_updated);
end; $$;
revoke all on function public.club_link_supplier_catalogue_to_commerce(uuid,text) from public,anon;
grant execute on function public.club_link_supplier_catalogue_to_commerce(uuid,text) to authenticated;


-- === APPLY supabase/migrations/2026-11-16-club-staff-permission-model.sql ===
-- Align Club management and operational staff packages at the authoritative database boundary.
-- Coach permissions and gym memberships remain independent systems.

create or replace function public.club_capabilities_for_role(p_role text)
returns text[] language sql immutable set search_path=pg_catalog,public as $$
  select case
    when p_role in ('owner','gym_admin') then array[
      'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
      'payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile',
      'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage',
      'induction.manage_policy','induction.perform','classes.manage','services.manage',
      'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
      'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
    ]::text[]
    when p_role in ('gym_staff','trainer') then array[
      'members.view','members.create','members.link_account','memberships.assign',
      'payments.take','payments.record_cash','refunds.issue','inventory.adjust','commerce.stock_remove',
      'induction.perform','classes.manage','services.manage','supplier.orders_manage','supplier.receive',
      'commerce.collections_manage','staff.work_submit'
    ]::text[]
    else '{}'::text[]
  end;
$$;
revoke all on function public.club_capabilities_for_role(text) from public,anon,authenticated;

alter table public.club_staff_permission_overrides drop constraint if exists club_staff_permission_overrides_capability_check;
alter table public.club_staff_permission_overrides add constraint club_staff_permission_overrides_capability_check check (capability in (
  'members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately',
  'payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile',
  'inventory.adjust','commerce.stock_remove','members.import','staff.permissions_manage',
  'induction.manage_policy','induction.perform','classes.manage','services.manage',
  'supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage',
  'commerce.collections_manage','finance.view','finance.manage','staff.work_submit','staff.work_review','finance.export'
));

create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null
    and p_user_id=auth.uid()
    and exists (
      select 1
      from public.club_members m
      where m.organisation_id=p_organisation_id
        and m.user_id=p_user_id
        and m.active
        and m.role in ('owner','gym_admin','gym_staff','trainer')
        and not exists (
          select 1 from public.club_staff_permission_overrides o
          where o.organisation_id=p_organisation_id and o.user_id=p_user_id
            and o.capability=p_capability and o.decision='deny'
        )
        and (
          p_capability=any(public.club_capabilities_for_role(m.role))
          or (
            p_capability<>'staff.permissions_manage'
            and exists (
              select 1 from public.club_staff_permission_overrides o
              where o.organisation_id=p_organisation_id and o.user_id=p_user_id
                and o.capability=p_capability and o.decision='allow'
            )
          )
        )
    );
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;

create or replace function public.club_save_staff_permission(p_organisation_id uuid,p_user_id uuid,p_capability text,p_decision text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff permission management is not permitted' using errcode='42501';
  end if;
  if p_decision not in ('allow','deny') or not (p_capability=any(public.club_capabilities_for_role('owner'))) then
    raise exception 'Invalid permission' using errcode='22023';
  end if;
  select role into target_role from public.club_members
    where organisation_id=p_organisation_id and user_id=p_user_id and active
      and role in ('owner','gym_admin','gym_staff','trainer');
  if target_role is null then raise exception 'Staff member not found' using errcode='P0002'; end if;
  if target_role='owner' and not public.club_has_active_role(p_organisation_id,array['owner']) then
    raise exception 'Only an owner may edit an owner' using errcode='42501';
  end if;
  if p_capability='staff.permissions_manage' and target_role not in ('owner','gym_admin') then
    raise exception 'Staff permission management is restricted to management roles' using errcode='42501';
  end if;
  if p_user_id=auth.uid() and p_capability='staff.permissions_manage' and p_decision='deny' then
    raise exception 'Managers cannot remove their own staff-management permission' using errcode='42501';
  end if;
  insert into public.club_staff_permission_overrides(organisation_id,user_id,capability,decision,created_by)
  values(p_organisation_id,p_user_id,p_capability,p_decision,auth.uid())
  on conflict (organisation_id,user_id,capability)
  do update set decision=excluded.decision,created_by=excluded.created_by,created_at=now();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.permission_changed','club_member',p_user_id,
    jsonb_build_object('capability',p_capability,'decision',p_decision)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;
revoke all on function public.club_save_staff_permission(uuid,uuid,text,text) from public,anon;
grant execute on function public.club_save_staff_permission(uuid,uuid,text,text) to authenticated;

create or replace function public.club_create_staff_access_grant(p_organisation_id uuid,p_email text,p_display_name text,p_role text,p_location_ids uuid[],p_capabilities text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; expected text[];
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff access requires staff-management permission' using errcode='42501';
  end if;
  if p_role not in ('gym_staff','gym_admin','trainer') or nullif(btrim(p_email),'') is null then
    raise exception 'Invalid staff access request' using errcode='22023';
  end if;
  expected:=public.club_capabilities_for_role(p_role);
  if (select coalesce(array_agg(distinct x order by x),'{}') from unnest(coalesce(p_capabilities,'{}')) x)
     is distinct from
     (select coalesce(array_agg(distinct x order by x),'{}') from unnest(expected) x) then
    raise exception 'The role permission package is invalid' using errcode='22023';
  end if;
  if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(
    select 1 from public.club_locations l where l.id=x and l.organisation_id=p_organisation_id and l.active
  )) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
  update public.club_staff_access_grants set status='expired'
    where organisation_id=p_organisation_id and email_normalized=lower(btrim(p_email))
      and status='pending' and expires_at<=now();
  insert into public.club_staff_access_grants(organisation_id,email_normalized,display_name,intended_role,location_ids,capabilities,created_by)
  values(p_organisation_id,lower(btrim(p_email)),nullif(btrim(p_display_name),''),p_role,coalesce(p_location_ids,'{}'),expected,auth.uid())
  returning * into g;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.access_grant_created','staff_access_grant',g.id,
    jsonb_build_object('role',p_role,'email',lower(btrim(p_email)))
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return to_jsonb(g);
end;
$$;
revoke all on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) from public,anon;
grant execute on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]) to authenticated;

create or replace function public.club_claim_staff_access_grant(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; account_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email) into account_email from auth.users where id=auth.uid();
  select * into g from public.club_staff_access_grants
    where id=p_grant_id and status='pending' and expires_at>now()
      and email_normalized=lower(btrim(account_email)) for update;
  if not found then raise exception 'Staff access grant is unavailable' using errcode='42501'; end if;
  if g.capabilities is distinct from public.club_capabilities_for_role(g.intended_role) then raise exception 'Staff access grant has an invalid permission package' using errcode='42501'; end if;
  insert into public.club_members(organisation_id,user_id,role,active)
  values(g.organisation_id,auth.uid(),g.intended_role,true)
  on conflict (organisation_id,user_id) do update set role=excluded.role,active=true;
  delete from public.club_staff_location_access where organisation_id=g.organisation_id and user_id=auth.uid();
  insert into public.club_staff_location_access(organisation_id,user_id,location_id)
    select g.organisation_id,auth.uid(),x from unnest(g.location_ids) x on conflict do nothing;
  -- Role defaults are evaluated centrally; an invitation must not manufacture permanent overrides.
  delete from public.club_staff_permission_overrides where organisation_id=g.organisation_id and user_id=auth.uid();
  update public.club_staff_access_grants set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=g.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(g.organisation_id,auth.uid(),g.intended_role,'staff.access_grant_claimed','staff_access_grant',g.id,jsonb_build_object('role',g.intended_role));
  return jsonb_build_object('id',g.id,'organisation_id',g.organisation_id,'role',g.intended_role,'status','accepted');
end;
$$;
revoke all on function public.club_claim_staff_access_grant(uuid) from public,anon;
grant execute on function public.club_claim_staff_access_grant(uuid) to authenticated;

create or replace function public.club_revoke_staff_access_grant(p_organisation_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  update public.club_staff_access_grants set status='revoked',revoked_at=now()
    where id=p_grant_id and organisation_id=p_organisation_id and status='pending' returning * into g;
  if not found then raise exception 'Pending grant not found' using errcode='P0002'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id)
  select p_organisation_id,auth.uid(),m.role,'staff.access_grant_revoked','staff_access_grant',g.id
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return to_jsonb(g);
end;
$$;

create or replace function public.club_replace_staff_locations(p_organisation_id uuid,p_user_id uuid,p_location_ids uuid[])
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  select role into target_role from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active;
  if target_role not in ('gym_staff','gym_admin','trainer') then raise exception 'Operational staff member not found' using errcode='P0002'; end if;
  if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(select 1 from public.club_locations l where l.organisation_id=p_organisation_id and l.id=x and l.active)) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
  delete from public.club_staff_location_access where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.club_staff_location_access(organisation_id,user_id,location_id)
    select p_organisation_id,p_user_id,x from unnest(coalesce(p_location_ids,'{}')) x;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.locations_changed','club_member',p_user_id,jsonb_build_object('location_ids',coalesce(p_location_ids,'{}'))
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;

create or replace function public.club_set_staff_active(p_organisation_id uuid,p_user_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_role text; owners integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  select role into target_role from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id;
  if target_role is null then raise exception 'Staff member not found' using errcode='P0002'; end if;
  if p_user_id=auth.uid() and not p_active then raise exception 'You cannot deactivate your own Club access' using errcode='42501'; end if;
  if target_role='owner' and not public.club_has_active_role(p_organisation_id,array['owner']) then raise exception 'Only an owner may edit an owner' using errcode='42501'; end if;
  if target_role='owner' and not p_active then
    select count(*) into owners from public.club_members where organisation_id=p_organisation_id and role='owner' and active;
    if owners<=1 then raise exception 'The organisation must retain an active owner' using errcode='42501'; end if;
  end if;
  update public.club_members set active=p_active where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.status_changed','club_member',p_user_id,jsonb_build_object('active',p_active)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;

create or replace function public.club_set_staff_role(p_organisation_id uuid,p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff access requires staff-management permission' using errcode='42501'; end if;
  if p_role not in ('gym_staff','trainer','gym_admin') then raise exception 'Invalid staff role' using errcode='22023'; end if;
  select role into current_role from public.club_members where organisation_id=p_organisation_id and user_id=p_user_id and active;
  if current_role is null then raise exception 'Staff member not found' using errcode='P0002'; end if;
  if current_role='owner' then raise exception 'Owner role is protected' using errcode='42501'; end if;
  update public.club_members set role=p_role where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.role_changed','club_member',p_user_id,jsonb_build_object('from',current_role,'to',p_role)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
end;
$$;

revoke all on function public.club_revoke_staff_access_grant(uuid,uuid) from public,anon;
revoke all on function public.club_replace_staff_locations(uuid,uuid,uuid[]) from public,anon;
revoke all on function public.club_set_staff_active(uuid,uuid,boolean) from public,anon;
revoke all on function public.club_set_staff_role(uuid,uuid,text) from public,anon;
grant execute on function public.club_revoke_staff_access_grant(uuid,uuid) to authenticated;
grant execute on function public.club_replace_staff_locations(uuid,uuid,uuid[]) to authenticated;
grant execute on function public.club_set_staff_active(uuid,uuid,boolean) to authenticated;
grant execute on function public.club_set_staff_role(uuid,uuid,text) to authenticated;

create or replace function public.club_append_audit_event(p_organisation_id uuid,p_action text,p_target_type text default null,p_target_id uuid default null,p_location_id uuid default null,p_reason text default null,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text; row public.club_audit_events%rowtype;
begin
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active and role in ('owner','gym_admin','gym_staff','trainer');
  if auth.uid() is null or actor_role is null then raise exception 'Audit actor is not authorised' using errcode='42501'; end if;
  if nullif(btrim(p_action),'') is null or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid audit event' using errcode='22023'; end if;
  if p_location_id is not null and not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id) then raise exception 'Audit location is outside organisation' using errcode='22023'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata)
  values(p_organisation_id,auth.uid(),actor_role,btrim(p_action),p_target_type,p_target_id,p_location_id,nullif(btrim(p_reason),''),coalesce(p_metadata,'{}')-'actor_user_id'-'organisation_id'-'actor_role')
  returning * into row;
  return to_jsonb(row);
end;
$$;
revoke all on function public.club_append_audit_event(uuid,text,text,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.club_append_audit_event(uuid,text,text,uuid,uuid,text,jsonb) to authenticated;

create or replace function public.club_create_customer(p_organisation_id uuid,p_user_id uuid,p_display_name text,p_email text,p_phone text,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_customers%rowtype; v_staff boolean;
begin
  v_staff:=auth.uid() is not null and public.club_capability_allowed(p_organisation_id,auth.uid(),'members.create');
  if auth.uid() is null or (not v_staff and p_user_id is distinct from auth.uid()) then raise exception 'Customer creation is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_organisations where id=p_organisation_id and active) then raise exception 'Organisation is unavailable' using errcode='22023'; end if;
  if nullif(btrim(p_display_name),'') is null or p_status not in ('guest','member','customer') or (not v_staff and p_status<>'customer') then raise exception 'Invalid customer input' using errcode='22023'; end if;
  insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
  values(p_organisation_id,p_user_id,btrim(p_display_name),p_email,p_phone,p_status) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.club_assign_membership(p_organisation_id uuid,p_product_id uuid,p_customer_id uuid,p_holder_user_ids uuid[],p_starts_at timestamptz,p_ends_at timestamptz,p_source text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_product public.club_products%rowtype; v_customer public.club_customers%rowtype; v_membership public.club_memberships%rowtype; v_users uuid[]; v_existing public.club_memberships%rowtype; v_holders jsonb; v_grants jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Membership assignment is not permitted' using errcode='42501'; end if;
  select * into v_product from public.club_products where id=p_product_id and organisation_id=p_organisation_id for share;
  if not found or v_product.archived_at is not null or v_product.kind<>'membership' then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at<=p_starts_at) or nullif(trim(p_idempotency_key),'') is null then raise exception 'Invalid membership assignment' using errcode='22023'; end if;
  if p_customer_id is null and coalesce(cardinality(p_holder_user_ids),0)=0 then raise exception 'At least one holder is required' using errcode='22023'; end if;
  if p_customer_id is not null then
    select * into v_customer from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
    if not found then raise exception 'Customer is not in this organisation' using errcode='42501'; end if;
  end if;
  select coalesce(array_agg(distinct x order by x),'{}') into v_users from unnest(coalesce(p_holder_user_ids,'{}')) x;
  if v_customer.user_id is not null then v_users:=array(select distinct x from unnest(v_users||v_customer.user_id) x order by x); end if;
  if exists(select 1 from unnest(v_users) x where not exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=x and m.active)) then raise exception 'Every holder must be an active organisation member' using errcode='22023'; end if;
  select * into v_existing from public.club_memberships where organisation_id=p_organisation_id and assignment_idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.product_id<>p_product_id or v_existing.starts_at<>p_starts_at or v_existing.ends_at is distinct from p_ends_at or v_existing.source<>p_source
      or (p_customer_id is not null and v_customer.user_id is null and not exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.customer_id=p_customer_id))
      or (p_customer_id is null and exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.customer_id is not null))
      or exists(select 1 from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null and not (h.user_id=any(v_users)))
      or (select count(*) from public.club_membership_holders h where h.membership_id=v_existing.id and h.user_id is not null)<>cardinality(v_users)
    then raise exception 'Membership assignment idempotency conflict' using errcode='23505'; end if;
    select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_existing.id;
    select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_existing.id;
    return jsonb_build_object('membership',to_jsonb(v_existing),'holders',v_holders,'grants',v_grants);
  end if;
  insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
  values(p_organisation_id,p_product_id,'active',p_starts_at,p_ends_at,p_source,p_idempotency_key) returning * into v_membership;
  if p_customer_id is not null and v_customer.user_id is null then insert into public.club_membership_holders(id,membership_id,organisation_id,customer_id) values(gen_random_uuid(),v_membership.id,p_organisation_id,p_customer_id); end if;
  insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) select gen_random_uuid(),v_membership.id,p_organisation_id,x from unnest(v_users) x;
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
  select u,v_membership.organisation_id,v_membership.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,v_membership.starts_at,v_membership.ends_at,v_membership.source from unnest(v_users) u join public.club_product_entitlements e on e.product_id=v_product.id;
  select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_holders from public.club_membership_holders h where h.membership_id=v_membership.id;
  select coalesce(jsonb_agg(to_jsonb(g)),'[]') into v_grants from public.club_entitlement_grants g where g.membership_id=v_membership.id;
  return jsonb_build_object('membership',to_jsonb(v_membership),'holders',v_holders,'grants',v_grants);
end;
$$;

create or replace function public.club_link_customer_user(p_customer_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; h record; e public.club_product_entitlements%rowtype;
begin
  select * into c from public.club_customers where id=p_customer_id for update;
  if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(c.organisation_id,auth.uid(),'members.link_account') then raise exception 'Customer linking is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_members m where m.organisation_id=c.organisation_id and m.user_id=p_user_id and m.active) then raise exception 'User is not an active organisation member' using errcode='42501'; end if;
  if c.user_id is not null and c.user_id<>p_user_id then raise exception 'Customer is already linked' using errcode='23505'; end if;
  update public.club_customers set user_id=p_user_id,updated_at=now() where id=c.id returning * into c;
  for h in select m.*,p.id product_id from public.club_membership_holders holder join public.club_memberships m on m.id=holder.membership_id join public.club_products p on p.id=m.product_id and p.organisation_id=m.organisation_id where holder.customer_id=c.id loop
    if exists(select 1 from public.club_membership_holders existing where existing.membership_id=h.id and existing.user_id=p_user_id) then delete from public.club_membership_holders where membership_id=h.id and customer_id=c.id; else update public.club_membership_holders set user_id=p_user_id,customer_id=null where membership_id=h.id and customer_id=c.id; end if;
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select p_user_id,h.organisation_id,h.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,h.starts_at,h.ends_at,h.source from public.club_product_entitlements e where e.product_id=h.product_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=h.id and g.user_id=p_user_id and g.entitlement_key=e.entitlement_key);
  end loop;
  return to_jsonb(c);
end;
$$;

create or replace function public.club_end_membership(p_organisation_id uuid,p_membership_id uuid,p_effective_at timestamptz,p_status text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.club_memberships%rowtype; at timestamptz:=coalesce(p_effective_at,now());
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.assign') then raise exception 'Membership ending is not permitted' using errcode='42501'; end if;
  if at<=now() and not public.club_capability_allowed(p_organisation_id,auth.uid(),'memberships.end_immediately') then raise exception 'Immediate membership ending is not permitted' using errcode='42501'; end if;
  select * into m from public.club_memberships where id=p_membership_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Membership not found' using errcode='P0002'; end if;
  if p_status not in ('cancelled','expired') then raise exception 'Invalid membership end status' using errcode='22023'; end if;
  if m.ends_at is not null and m.ends_at<=at then return to_jsonb(m); end if;
  update public.club_memberships set ends_at=at,status=case when at<=now() then p_status else status end,ended_at=case when at<=now() then now() else ended_at end,ended_by=case when at<=now() then auth.uid() else ended_by end,end_requested_at=now(),end_requested_by=auth.uid(),end_reason=coalesce(p_reason,end_reason) where id=m.id returning * into m;
  return to_jsonb(m);
end;
$$;

revoke all on function public.club_create_customer(uuid,uuid,text,text,text,text) from public,anon;
revoke all on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) from public,anon;
revoke all on function public.club_link_customer_user(uuid,uuid) from public,anon;
revoke all on function public.club_end_membership(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.club_create_customer(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.club_assign_membership(uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.club_link_customer_user(uuid,uuid) to authenticated;
grant execute on function public.club_end_membership(uuid,uuid,timestamptz,text,text) to authenticated;

create or replace function public.club_create_service_transaction(p_organisation_id uuid,p_location_id uuid,p_service_id uuid,p_customer_id uuid,p_quantity integer,p_unit_price_minor integer,p_currency text,p_payment_status text,p_payment_method text,p_payment_reference text,p_fulfilment_status text,p_external_fulfilment_reference text,p_occurred_at timestamptz,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_service_transactions%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage') then raise exception 'Service transaction creation is not permitted' using errcode='42501'; end if;
  if p_quantity<=0 or p_unit_price_minor<0 or p_currency!~'^[A-Z]{3}$' or p_payment_status not in ('unpaid','pending','paid','waived','refunded') or p_fulfilment_status not in ('pending','fulfilled','cancelled','failed') or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid service transaction input' using errcode='22023'; end if;
  if not exists(select 1 from public.club_services where id=p_service_id and organisation_id=p_organisation_id and (location_id is null or location_id=p_location_id)) then raise exception 'Service is unavailable at location' using errcode='22023'; end if;
  if p_customer_id is not null and not exists(select 1 from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id) then raise exception 'Customer is not in transaction organisation' using errcode='22023'; end if;
  insert into public.club_service_transactions(organisation_id,location_id,service_id,customer_id,staff_user_id,quantity,unit_price_minor,currency,payment_status,payment_method,payment_reference,fulfilment_status,external_fulfilment_reference,occurred_at,metadata)
  values(p_organisation_id,p_location_id,p_service_id,p_customer_id,auth.uid(),p_quantity,p_unit_price_minor,p_currency,p_payment_status,p_payment_method,p_payment_reference,p_fulfilment_status,p_external_fulfilment_reference,coalesce(p_occurred_at,now()),p_metadata) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.club_save_service(p_id uuid,p_organisation_id uuid,p_location_id uuid,p_name text,p_description text,p_category text,p_duration_minutes integer,p_price_minor integer,p_currency text,p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_services%rowtype;
begin
  if auth.uid() is null
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'services.manage')
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')
  then raise exception 'Service administration is not permitted' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_category),'') is null or (p_duration_minutes is not null and p_duration_minutes<=0) or (p_price_minor is not null and p_price_minor<0) or p_currency!~'^[A-Z]{3}$' or p_active is null then raise exception 'Invalid service input' using errcode='22023'; end if;
  if p_id is null then
    insert into public.club_services(organisation_id,location_id,name,description,category,duration_minutes,price_minor,currency,active)
    values(p_organisation_id,p_location_id,btrim(p_name),p_description,btrim(p_category),p_duration_minutes,p_price_minor,p_currency,p_active) returning * into v_row;
  else
    update public.club_services set location_id=p_location_id,name=btrim(p_name),description=p_description,category=btrim(p_category),duration_minutes=p_duration_minutes,price_minor=p_price_minor,currency=p_currency,active=p_active,updated_at=now()
    where id=p_id and organisation_id=p_organisation_id returning * into v_row;
    if not found then raise exception 'Service not found' using errcode='P0002'; end if;
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.club_update_service_transaction(p_transaction_id uuid,p_payment_status text,p_payment_method text,p_payment_reference text,p_fulfilment_status text,p_external_fulfilment_reference text,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.club_service_transactions%rowtype;
begin
  select * into v_row from public.club_service_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Service transaction not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.club_capability_allowed(v_row.organisation_id,auth.uid(),'services.manage') then raise exception 'Service transaction update is not permitted' using errcode='42501'; end if;
  if p_payment_status not in ('unpaid','pending','paid','waived','refunded') or p_fulfilment_status not in ('pending','fulfilled','cancelled','failed') or (p_metadata is not null and jsonb_typeof(p_metadata)<>'object') then raise exception 'Invalid service transaction update' using errcode='22023'; end if;
  update public.club_service_transactions set payment_status=p_payment_status,payment_method=p_payment_method,payment_reference=p_payment_reference,fulfilment_status=p_fulfilment_status,external_fulfilment_reference=p_external_fulfilment_reference,metadata=p_metadata,updated_at=now() where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.club_create_service_transaction(uuid,uuid,uuid,uuid,integer,integer,text,text,text,text,text,text,timestamptz,jsonb) from public,anon;
revoke all on function public.club_update_service_transaction(uuid,text,text,text,text,text,jsonb) from public,anon;
revoke all on function public.club_save_service(uuid,uuid,uuid,text,text,text,integer,integer,text,boolean) from public,anon;
grant execute on function public.club_create_service_transaction(uuid,uuid,uuid,uuid,integer,integer,text,text,text,text,text,text,timestamptz,jsonb) to authenticated;
grant execute on function public.club_update_service_transaction(uuid,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.club_save_service(uuid,uuid,uuid,text,text,text,integer,integer,text,boolean) to authenticated;

-- Existing Coach permission RPCs remain the sole source of Coach access.
-- Existing club membership records remain independent from both staff and Coach access.


-- === APPLY supabase/migrations/2026-11-17-club-staff-account-onboarding.sql ===
-- Complete the existing staff access-grant workflow with explicit Coach intent,
-- profile creation, safe claiming, management reads and attributable Coach audit.

alter table public.club_staff_access_grants
  add column if not exists coach_requested boolean not null default false,
  add column if not exists member_intent boolean not null default false;

drop function if exists public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[]);

create or replace function public.club_create_staff_access_grant(
  p_organisation_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_location_ids uuid[],
  p_capabilities text[],
  p_coach_requested boolean,
  p_member_intent boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; expected text[]; normalized_email text:=lower(btrim(p_email));
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff access requires staff-management permission' using errcode='42501';
  end if;
  if p_role not in ('gym_staff','gym_admin','trainer') or normalized_email is null or normalized_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(btrim(p_display_name),'') is null then
    raise exception 'Invalid staff access request' using errcode='22023';
  end if;
  if coalesce(p_coach_requested,false) and p_role not in ('gym_admin','trainer') then
    raise exception 'Coach access is unavailable for this staff role' using errcode='22023';
  end if;
  expected:=public.club_capabilities_for_role(p_role);
  if (select coalesce(array_agg(distinct x order by x),'{}') from unnest(coalesce(p_capabilities,'{}')) x)
     is distinct from
     (select coalesce(array_agg(distinct x order by x),'{}') from unnest(expected) x) then
    raise exception 'The role permission package is invalid' using errcode='22023';
  end if;
  if exists(select 1 from unnest(coalesce(p_location_ids,'{}')) x where not exists(
    select 1 from public.club_locations l where l.id=x and l.organisation_id=p_organisation_id and l.active
  )) then raise exception 'Location is not in this organisation' using errcode='22023'; end if;
  if exists(
    select 1 from public.club_members m
    join public.profiles p on p.id=m.user_id
    where m.organisation_id=p_organisation_id and m.active
      and m.role in ('owner','gym_admin','gym_staff','trainer')
      and lower(btrim(p.email))=normalized_email
  ) then raise exception 'That account already has active staff access' using errcode='23505'; end if;
  update public.club_staff_access_grants set status='expired'
    where organisation_id=p_organisation_id and email_normalized=normalized_email
      and status='pending' and expires_at<=now();
  if exists(select 1 from public.club_staff_access_grants where organisation_id=p_organisation_id and email_normalized=normalized_email and status='pending') then
    raise exception 'Staff access is already pending for this email' using errcode='23505';
  end if;
  insert into public.club_staff_access_grants(
    organisation_id,email_normalized,display_name,intended_role,location_ids,capabilities,
    coach_requested,member_intent,created_by
  ) values(
    p_organisation_id,normalized_email,left(btrim(p_display_name),160),p_role,
    coalesce(p_location_ids,'{}'),expected,coalesce(p_coach_requested,false),
    coalesce(p_member_intent,false),auth.uid()
  ) returning * into g;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  select p_organisation_id,auth.uid(),m.role,'staff.access_grant_created','staff_access_grant',g.id,
    jsonb_build_object('role',p_role,'email',normalized_email,'coach_requested',g.coach_requested,'member_intent',g.member_intent)
  from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid();
  return to_jsonb(g);
end;
$$;
revoke all on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[],boolean,boolean) from public,anon;
grant execute on function public.club_create_staff_access_grant(uuid,text,text,text,uuid[],text[],boolean,boolean) to authenticated;

create or replace function public.club_claim_staff_access_grant(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  g public.club_staff_access_grants%rowtype;
  account_email text;
  account_metadata jsonb;
  profile_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email),coalesce(raw_user_meta_data,'{}'::jsonb)
    into account_email,account_metadata from auth.users where id=auth.uid();
  select * into g from public.club_staff_access_grants
    where id=p_grant_id and status='pending' and expires_at>now()
      and email_normalized=lower(btrim(account_email)) for update;
  if not found then raise exception 'Staff access grant is unavailable for this account' using errcode='42501'; end if;
  if g.capabilities is distinct from public.club_capabilities_for_role(g.intended_role) then
    raise exception 'Staff access grant has an invalid permission package' using errcode='42501';
  end if;
  if g.coach_requested and g.intended_role not in ('gym_admin','trainer') then
    raise exception 'Staff access grant has invalid Coach intent' using errcode='42501';
  end if;
  if exists(
    select 1 from public.club_members
    where organisation_id=g.organisation_id and user_id=auth.uid() and active
      and role in ('owner','gym_admin','gym_staff','trainer')
  ) then
    raise exception 'This account already has active staff access' using errcode='23505';
  end if;
  profile_name:=coalesce(
    nullif(btrim(g.display_name),''),
    nullif(btrim(account_metadata->>'display_name'),''),
    nullif(btrim(concat_ws(' ',account_metadata->>'first_name',account_metadata->>'last_name')),''),
    split_part(account_email,'@',1)
  );
  insert into public.profiles(id,email,display_name,first_name,last_name)
  values(
    auth.uid(),account_email,profile_name,
    nullif(btrim(account_metadata->>'first_name'),''),
    nullif(btrim(account_metadata->>'last_name'),'')
  )
  on conflict (id) do update set
    email=excluded.email,
    display_name=coalesce(nullif(btrim(public.profiles.display_name),''),excluded.display_name),
    first_name=coalesce(nullif(btrim(public.profiles.first_name),''),excluded.first_name),
    last_name=coalesce(nullif(btrim(public.profiles.last_name),''),excluded.last_name);
  insert into public.club_members(organisation_id,user_id,role,active)
  values(g.organisation_id,auth.uid(),g.intended_role,true)
  on conflict (organisation_id,user_id) do update set role=excluded.role,active=true;
  delete from public.club_staff_location_access where organisation_id=g.organisation_id and user_id=auth.uid();
  insert into public.club_staff_location_access(organisation_id,user_id,location_id)
    select g.organisation_id,auth.uid(),x from unnest(g.location_ids) x on conflict do nothing;
  delete from public.club_staff_permission_overrides where organisation_id=g.organisation_id and user_id=auth.uid();
  insert into public.coach_permissions(organisation_id,user_id,granted_by,active)
  values(g.organisation_id,auth.uid(),g.created_by,g.coach_requested)
  on conflict (organisation_id,user_id) do update
    set active=excluded.active,granted_by=excluded.granted_by;
  update public.club_staff_access_grants set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=g.id;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(
    g.organisation_id,auth.uid(),g.intended_role,'staff.access_grant_claimed','staff_access_grant',g.id,
    jsonb_build_object('role',g.intended_role,'coach_requested',g.coach_requested,'prepared_by',g.created_by)
  );
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(
    g.organisation_id,auth.uid(),g.intended_role,'coach.access_changed','club_member',auth.uid(),
    jsonb_build_object('active',g.coach_requested,'source','staff_access_grant','prepared_by',g.created_by)
  );
  return jsonb_build_object(
    'id',g.id,'organisation_id',g.organisation_id,'role',g.intended_role,
    'coach_active',g.coach_requested,'member_intent',g.member_intent,'status','accepted'
  );
end;
$$;
revoke all on function public.club_claim_staff_access_grant(uuid) from public,anon;
grant execute on function public.club_claim_staff_access_grant(uuid) to authenticated;

create or replace function public.coach_grant_permission(p_organisation_id uuid,p_user_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.coach_permissions%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Coach permission administration denied' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.club_members
    where organisation_id=p_organisation_id and user_id=p_user_id and active
      and role in ('trainer','gym_admin','owner')
  ) then raise exception 'Coach user is not eligible' using errcode='42501'; end if;
  select role into actor_role from public.club_members
    where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.coach_permissions(organisation_id,user_id,granted_by,active)
  values(p_organisation_id,p_user_id,auth.uid(),p_active)
  on conflict (organisation_id,user_id) do update
    set active=excluded.active,granted_by=excluded.granted_by
  returning * into result;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
  values(p_organisation_id,auth.uid(),actor_role,'coach.access_changed','club_member',p_user_id,jsonb_build_object('active',p_active));
  return to_jsonb(result);
end;
$$;
revoke all on function public.coach_grant_permission(uuid,uuid,boolean) from public,anon;
grant execute on function public.coach_grant_permission(uuid,uuid,boolean) to authenticated;

create or replace function public.club_list_my_pending_staff_access()
returns table(
  id uuid,organisation_id uuid,organisation_name text,display_name text,intended_role text,
  location_ids uuid[],coach_requested boolean,member_intent boolean,expires_at timestamptz
) language sql stable security definer set search_path=pg_catalog,public as $$
  select g.id,g.organisation_id,o.name,g.display_name,g.intended_role,g.location_ids,
    g.coach_requested,g.member_intent,g.expires_at
  from public.club_staff_access_grants g
  join public.club_organisations o on o.id=g.organisation_id and o.active
  where auth.uid() is not null
    and g.email_normalized=lower(btrim(coalesce(auth.jwt()->>'email','')))
    and g.status='pending' and g.expires_at>now()
  order by g.created_at;
$$;
revoke all on function public.club_list_my_pending_staff_access() from public,anon;
grant execute on function public.club_list_my_pending_staff_access() to authenticated;

create or replace function public.club_list_staff_accounts(p_organisation_id uuid)
returns table(
  member_id uuid,user_id uuid,display_name text,email text,role text,active boolean,
  is_gym_member boolean,membership_name text
) language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then
    raise exception 'Staff account directory is not permitted' using errcode='42501';
  end if;
  return query
    select m.id,m.user_id,
      coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.email),''),'Staff member'),
      nullif(btrim(p.email),''),m.role,m.active,(membership.id is not null),membership.product_name
    from public.club_members m
    left join public.profiles p on p.id=m.user_id
    left join lateral (
      select ms.id,product.name product_name
      from public.club_memberships ms
      join public.club_membership_holders h on h.membership_id=ms.id and h.user_id=m.user_id
      join public.club_products product on product.id=ms.product_id and product.organisation_id=ms.organisation_id
      where ms.organisation_id=p_organisation_id
        and ms.status='active' and ms.starts_at<=now() and (ms.ends_at is null or ms.ends_at>now())
      order by ms.starts_at desc limit 1
    ) membership on true
    where m.organisation_id=p_organisation_id and m.role in ('owner','gym_admin','gym_staff','trainer')
    order by m.active desc,coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.email),''),'Staff member'),m.created_at;
end;
$$;
revoke all on function public.club_list_staff_accounts(uuid) from public,anon;
grant execute on function public.club_list_staff_accounts(uuid) to authenticated;


-- === APPLY supabase/migrations/2026-11-18-member-acquisition-onboarding.sql ===
-- Durable member acquisition, verified-email activation and provider-safe payment handoff.
-- This migration creates no users, imports no members and activates no paid membership.

alter table public.club_customers
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists town_city text,
  add column if not exists postcode text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz;

alter table public.club_membership_join_requests
  drop constraint if exists club_membership_join_requests_status_check;
alter table public.club_membership_join_requests
  add constraint club_membership_join_requests_status_check check (status in (
    'details_recorded','payment_required','payment_pending','payment_failed','retry_required',
    'staff_review','ready_to_activate','active','completed','cancelled'
  )),
  add column if not exists location_id uuid,
  add column if not exists payment_method text,
  add column if not exists payment_state text not null default 'required',
  add column if not exists payment_provider text,
  add column if not exists payment_provider_reference text,
  add column if not exists payment_failure_reason text,
  add column if not exists membership_id uuid,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists reminder_eligible_at timestamptz,
  add column if not exists completed_at timestamptz,
  add constraint club_join_location_org_fk foreign key(location_id,organisation_id) references public.club_locations(id,organisation_id),
  add constraint club_join_membership_org_fk foreign key(membership_id,organisation_id) references public.club_memberships(id,organisation_id),
  add constraint club_join_payment_method_check check(payment_method is null or payment_method in ('none','card','direct_debit','staff_manual')),
  add constraint club_join_payment_state_check check(payment_state in ('not_required','required','pending','failed','unavailable','confirmed'));
alter table public.club_membership_join_requests
  add constraint club_join_requests_id_org_key unique(id,organisation_id);

with duplicate_open as (
  select id,row_number() over(partition by organisation_id,user_id order by updated_at desc,created_at desc) position
  from public.club_membership_join_requests where status not in ('completed','cancelled')
)
update public.club_membership_join_requests set status='cancelled',updated_at=now()
where id in (select id from duplicate_open where position>1);
create unique index if not exists club_join_requests_one_open_per_user
  on public.club_membership_join_requests(organisation_id,user_id)
  where status not in ('completed','cancelled');

create table if not exists public.club_member_notification_intents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  join_request_id uuid,
  category text not null check(category in ('member_service','billing')),
  template_key text not null,
  state text not null default 'unavailable' check(state in ('pending','unavailable','sent','failed','cancelled')),
  idempotency_key text not null,
  not_before timestamptz not null default now(),
  provider_reference text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organisation_id,idempotency_key),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete cascade
);
alter table public.club_member_notification_intents enable row level security;
revoke all on table public.club_member_notification_intents from public,anon,authenticated;

create or replace function public.club_list_join_locations(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',l.id,'name',l.name)
  from public.club_locations l join public.club_organisations o on o.id=l.organisation_id
  where l.organisation_id=p_organisation_id and l.active and o.active and o.member_joinable order by l.name;
$$;
revoke all on function public.club_list_join_locations(uuid) from public,anon,authenticated;
grant execute on function public.club_list_join_locations(uuid) to anon,authenticated;
grant execute on function public.club_list_joinable_organisations() to anon,authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to anon,authenticated;

drop function if exists public.club_start_membership_joining(uuid,uuid,text,text,text,text);
create or replace function public.club_start_membership_joining(
  p_organisation_id uuid,p_product_id uuid,p_location_id uuid,p_first_name text,p_last_name text,
  p_email text,p_phone text,p_date_of_birth date,p_address_line_1 text,p_address_line_2 text,
  p_town_city text,p_postcode text,p_emergency_name text,p_emergency_phone text,
  p_terms_accepted boolean,p_privacy_accepted boolean,p_marketing_consent boolean,
  p_payment_method text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user uuid:=auth.uid(); v_auth record; v_customer public.club_customers%rowtype;
  v_product public.club_products%rowtype; v_request public.club_membership_join_requests%rowtype;
  v_status text; v_payment_state text; v_method text;
begin
  if v_user is null then raise exception 'Sign in to start joining' using errcode='42501'; end if;
  select lower(btrim(email)) email,email_confirmed_at,raw_user_meta_data into v_auth from auth.users where id=v_user;
  if v_auth.email_confirmed_at is null then raise exception 'Confirm your email before joining' using errcode='42501'; end if;
  if v_auth.email is distinct from lower(btrim(p_email)) then raise exception 'Joining email must match the signed-in account' using errcode='42501'; end if;
  if nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null
    or nullif(btrim(p_phone),'') is null or p_date_of_birth is null or p_date_of_birth>=current_date
    or nullif(btrim(p_address_line_1),'') is null or nullif(btrim(p_postcode),'') is null
    or nullif(btrim(p_emergency_name),'') is null or nullif(btrim(p_emergency_phone),'') is null
    or not coalesce(p_terms_accepted,false) or not coalesce(p_privacy_accepted,false)
    or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Joining details are incomplete' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Venue is unavailable' using errcode='22023'; end if;
  select p.* into v_product from public.club_products p join public.club_organisations o on o.id=p.organisation_id
    where p.id=p_product_id and p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null and o.active and o.member_joinable;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  v_method:=case when v_product.price_minor=0 then 'none' else p_payment_method end;
  if v_method not in ('none','card','direct_debit','staff_manual') or (v_product.price_minor>0 and v_method='none') then raise exception 'Choose a payment method' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then
    if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_auth.email and user_id is distinct from v_user) then
      raise exception 'An existing member record matches this email; claim it instead' using errcode='23505';
    end if;
    insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status) values(
      p_organisation_id,v_user,btrim(p_first_name)||' '||btrim(p_last_name),v_auth.email,btrim(p_phone),'customer'
    ) returning * into v_customer;
  end if;
  update public.club_customers set display_name=btrim(p_first_name)||' '||btrim(p_last_name),email=v_auth.email,phone=btrim(p_phone),
    first_name=btrim(p_first_name),last_name=btrim(p_last_name),date_of_birth=p_date_of_birth,address_line_1=btrim(p_address_line_1),
    address_line_2=nullif(btrim(p_address_line_2),''),town_city=nullif(btrim(p_town_city),''),postcode=upper(btrim(p_postcode)),
    emergency_contact_name=btrim(p_emergency_name),emergency_contact_phone=btrim(p_emergency_phone),
    terms_accepted_at=coalesce(terms_accepted_at,now()),privacy_accepted_at=coalesce(privacy_accepted_at,now()),
    marketing_consent=coalesce(p_marketing_consent,false),marketing_consent_at=case when p_marketing_consent then now() else null end,updated_at=now()
    where id=v_customer.id returning * into v_customer;
  insert into public.profiles(id,email,display_name,first_name,last_name) values(v_user,v_auth.email,v_customer.display_name,btrim(p_first_name),btrim(p_last_name))
    on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name;
  insert into public.club_members(organisation_id,user_id,role,active,preferred_location_id) values(p_organisation_id,v_user,'member',true,p_location_id)
    on conflict(organisation_id,user_id) do update set active=true,preferred_location_id=excluded.preferred_location_id;
  select * into v_request from public.club_membership_join_requests where organisation_id=p_organisation_id and user_id=v_user and status not in ('completed','cancelled') for update;
  v_status:=case when v_product.price_minor=0 then 'ready_to_activate' when v_method='staff_manual' then 'staff_review' else 'payment_required' end;
  v_payment_state:=case when v_product.price_minor=0 then 'not_required' when v_method='staff_manual' then 'pending' else 'unavailable' end;
  if found then
    update public.club_membership_join_requests set customer_id=v_customer.id,product_id=v_product.id,location_id=p_location_id,status=v_status,
      payment_method=v_method,payment_state=v_payment_state,payment_provider=case when v_method='card' then 'stripe' when v_method='direct_debit' then 'gocardless' end,
      payment_failure_reason=null,last_activity_at=now(),reminder_eligible_at=case when v_product.price_minor>0 then now()+interval '24 hours' end,updated_at=now()
      where id=v_request.id returning * into v_request;
  else
    insert into public.club_membership_join_requests(organisation_id,user_id,customer_id,product_id,location_id,status,idempotency_key,payment_method,payment_state,payment_provider,last_activity_at,reminder_eligible_at)
    values(p_organisation_id,v_user,v_customer.id,v_product.id,p_location_id,v_status,btrim(p_idempotency_key),v_method,v_payment_state,
      case when v_method='card' then 'stripe' when v_method='direct_debit' then 'gocardless' end,now(),case when v_product.price_minor>0 then now()+interval '24 hours' end) returning * into v_request;
  end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before)
    values(p_organisation_id,v_user,v_request.id,case when v_product.price_minor>0 then 'billing' else 'member_service' end,'join_incomplete','unavailable','join-reminder:'||v_request.id,coalesce(v_request.reminder_eligible_at,now()+interval '24 hours'))
    on conflict(organisation_id,idempotency_key) do nothing;
  return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product));
end; $$;
revoke all on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) to authenticated;

create or replace function public.club_activate_no_payment_join(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; p public.club_products%rowtype; m public.club_memberships%rowtype; v_end timestamptz;
begin
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.status not in ('ready_to_activate','active') or r.payment_state<>'not_required' then raise exception 'Join request is not ready' using errcode='42501'; end if;
  select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and price_minor=0 and sellable and archived_at is null;
  if not found then raise exception 'No-payment membership is unavailable' using errcode='22023'; end if;
  select * into m from public.club_memberships where organisation_id=r.organisation_id and assignment_idempotency_key='join:'||r.id for update;
  if not found then
    v_end:=case when p.duration_days is null then null else now()+make_interval(days=>p.duration_days) end;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
      values(r.organisation_id,p.id,'active',now(),v_end,'member_join','join:'||r.id) returning * into m;
    insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values(gen_random_uuid(),m.id,r.organisation_id,auth.uid());
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select auth.uid(),m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source
      from public.club_product_entitlements e where e.product_id=p.id;
  end if;
  update public.club_membership_join_requests set status='active',payment_state='not_required',membership_id=m.id,completed_at=coalesce(completed_at,now()),last_activity_at=now(),updated_at=now() where id=r.id;
  update public.club_member_notification_intents set state='cancelled' where join_request_id=r.id and template_key='join_incomplete';
  return jsonb_build_object('request_id',r.id,'membership_id',m.id,'status','active');
end; $$;
revoke all on function public.club_activate_no_payment_join(uuid) from public,anon;
grant execute on function public.club_activate_no_payment_join(uuid) to authenticated;

create or replace function public.club_get_my_join_state(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select j.*,p.name product_name,p.price_minor,p.currency,p.billing,l.name location_name into r
    from public.club_membership_join_requests j join public.club_products p on p.id=j.product_id left join public.club_locations l on l.id=j.location_id
    where j.organisation_id=p_organisation_id and j.user_id=auth.uid() order by j.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_method',r.payment_method,
    'payment_provider',r.payment_provider,'product_name',r.product_name,'price_minor',r.price_minor,'currency',r.currency,
    'billing',r.billing,'location_name',r.location_name,'membership_id',r.membership_id,'updated_at',r.updated_at);
end; $$;
revoke all on function public.club_get_my_join_state(uuid) from public,anon;
grant execute on function public.club_get_my_join_state(uuid) to authenticated;

create or replace function public.club_retry_join_payment(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.payment_method not in ('card','direct_debit') or r.status not in ('payment_required','payment_failed','retry_required') then raise exception 'Payment retry is unavailable' using errcode='42501'; end if;
  update public.club_membership_join_requests set status='payment_required',payment_state='unavailable',payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_provider',r.payment_provider);
end; $$;
revoke all on function public.club_retry_join_payment(uuid) from public,anon;
grant execute on function public.club_retry_join_payment(uuid) to authenticated;

create or replace function public.club_preview_existing_member_claim(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_email text; v_verified timestamptz; v_count integer; c public.club_customers%rowtype;
begin
  select lower(btrim(email)),email_confirmed_at into v_email,v_verified from auth.users where id=auth.uid();
  if auth.uid() is null or v_verified is null then return jsonb_build_object('state','email_verification_required'); end if;
  select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count=0 then return jsonb_build_object('state','staff_help_required'); end if;
  if v_count>1 then return jsonb_build_object('state','ambiguous','message','More than one member record uses this email'); end if;
  select * into c from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if c.user_id=auth.uid() then return jsonb_build_object('state','already_linked'); end if;
  if c.user_id is not null then return jsonb_build_object('state','staff_help_required'); end if;
  return jsonb_build_object('state','ready','customer_id',c.id,'display_name',c.display_name,'email',c.email,
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.name,'status',m.status)) from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_products p on p.id=m.product_id where h.customer_id=c.id),'[]'::jsonb));
end; $$;
revoke all on function public.club_preview_existing_member_claim(uuid) from public,anon;
grant execute on function public.club_preview_existing_member_claim(uuid) to authenticated;

create or replace function public.club_claim_existing_member(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_email text; v_verified timestamptz; v_count integer; c public.club_customers%rowtype; h record; e record; actor_role text;
begin
  select lower(btrim(email)),email_confirmed_at into v_email,v_verified from auth.users where id=auth.uid();
  if auth.uid() is null or v_verified is null then raise exception 'Verified account required' using errcode='42501'; end if;
  select count(*) into v_count from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_email;
  if v_count<>1 then raise exception 'Member record is missing or ambiguous' using errcode='42501'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id and user_id is null and lower(btrim(email))=v_email for update;
  if not found then raise exception 'Member record does not match this account' using errcode='42501'; end if;
  if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and user_id=auth.uid() and id<>c.id) then raise exception 'Account is already linked to another member' using errcode='23505'; end if;
  insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,auth.uid(),'member',true)
    on conflict(organisation_id,user_id) do update set active=true;
  update public.club_customers set user_id=auth.uid(),updated_at=now() where id=c.id returning * into c;
  for h in select m.*,p.id product_id from public.club_membership_holders holder join public.club_memberships m on m.id=holder.membership_id join public.club_products p on p.id=m.product_id where holder.customer_id=c.id loop
    if exists(select 1 from public.club_membership_holders where membership_id=h.id and user_id=auth.uid()) then delete from public.club_membership_holders where membership_id=h.id and customer_id=c.id; else update public.club_membership_holders set user_id=auth.uid(),customer_id=null where membership_id=h.id and customer_id=c.id; end if;
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select auth.uid(),h.organisation_id,h.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,h.starts_at,h.ends_at,h.source
      from public.club_product_entitlements e where e.product_id=h.product_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=h.id and g.user_id=auth.uid() and g.entitlement_key=e.entitlement_key);
  end loop;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.account_self_claimed','customer',c.id,jsonb_build_object('match','verified_email'));
  return jsonb_build_object('customer_id',c.id,'status','linked');
end; $$;
revoke all on function public.club_claim_existing_member(uuid,uuid) from public,anon;
grant execute on function public.club_claim_existing_member(uuid,uuid) to authenticated;

create or replace function public.club_staff_link_member_account(p_organisation_id uuid,p_customer_id uuid,p_target_email text,p_verification_method text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; target_user uuid; actor_role text; h record;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') then raise exception 'Account linking is not permitted' using errcode='42501'; end if;
  if p_verification_method not in ('photo_id','membership_reference','in_person') or length(btrim(coalesce(p_reason,'')))<8 then raise exception 'Verification evidence and reason are required' using errcode='22023'; end if;
  select id into target_user from auth.users where lower(btrim(email))=lower(btrim(p_target_email)) and email_confirmed_at is not null;
  if target_user is null then raise exception 'No verified R12 account matches that email' using errcode='P0002'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for update;
  if not found or (c.user_id is not null and c.user_id<>target_user) then raise exception 'Member record cannot be linked' using errcode='23505'; end if;
  if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and user_id=target_user and id<>c.id) then raise exception 'R12 account is already linked to another member' using errcode='23505'; end if;
  insert into public.club_members(organisation_id,user_id,role,active) values(p_organisation_id,target_user,'member',true)
    on conflict(organisation_id,user_id) do update set active=true;
  update public.club_customers set user_id=target_user,updated_at=now() where id=c.id;
  for h in select membership_id from public.club_membership_holders where customer_id=c.id loop
    if exists(select 1 from public.club_membership_holders where membership_id=h.membership_id and user_id=target_user) then delete from public.club_membership_holders where membership_id=h.membership_id and customer_id=c.id; else update public.club_membership_holders set user_id=target_user,customer_id=null where membership_id=h.membership_id and customer_id=c.id; end if;
  end loop;
  insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
    select target_user,m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source
    from public.club_memberships m join public.club_product_entitlements e on e.product_id=m.product_id join public.club_membership_holders holder on holder.membership_id=m.id and holder.user_id=target_user
    where m.organisation_id=p_organisation_id and not exists(select 1 from public.club_entitlement_grants g where g.membership_id=m.id and g.user_id=target_user and g.entitlement_key=e.entitlement_key);
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid();
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,reason,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.account_staff_linked','customer',c.id,btrim(p_reason),jsonb_build_object('target_user_id',target_user,'verification_method',p_verification_method));
  return jsonb_build_object('customer_id',c.id,'user_id',target_user,'status','linked');
end; $$;
revoke all on function public.club_staff_link_member_account(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.club_staff_link_member_account(uuid,uuid,text,text,text) to authenticated;


-- === APPLY supabase/migrations/2026-11-19-madhouse-billing-and-tutorials.sql ===
-- Madhouse public-join billing contract and versioned first-use tutorials.
-- Provider confirmations remain service-role only. This migration sends no
-- payment request, creates no provider credential and grants no Coach access.

alter table public.club_membership_join_requests
  drop constraint if exists club_join_payment_method_check;
alter table public.club_membership_join_requests
  add column if not exists checkout_kind text not null default 'one_off',
  add column if not exists joining_fee_minor integer not null default 0,
  add column if not exists first_period_minor integer not null default 0,
  add column if not exists upfront_amount_minor integer not null default 0,
  add column if not exists upfront_provider text,
  add column if not exists upfront_payment_state text not null default 'required',
  add column if not exists recurring_provider text,
  add column if not exists recurring_authority_state text not null default 'not_required',
  add column if not exists recurring_authority_reference text,
  add column if not exists billing_anchor_day integer,
  add column if not exists paid_through_at timestamptz,
  add constraint club_join_payment_method_check check(payment_method is null or payment_method in ('none','card','direct_debit','card_and_direct_debit','staff_manual')),
  add constraint club_join_checkout_kind_check check(checkout_kind in ('free','monthly_recurring','day_pass','week_pass','annual_one_off','one_off','manual')),
  add constraint club_join_amounts_check check(joining_fee_minor>=0 and first_period_minor>=0 and upfront_amount_minor=joining_fee_minor+first_period_minor),
  add constraint club_join_upfront_state_check check(upfront_payment_state in ('not_required','required','pending','failed','unavailable','confirmed')),
  add constraint club_join_recurring_state_check check(recurring_authority_state in ('not_required','required','pending','failed','unavailable','confirmed')),
  add constraint club_join_anchor_check check(billing_anchor_day is null or billing_anchor_day between 1 and 31);

-- The installed catalogue previously described Yearly as recurring. Madhouse
-- sells it as a paid 365-day period with an explicit renewal, not an automatic
-- annual collection.
update public.club_products p
set billing='one_off',duration_days=365
from public.club_organisations o
where p.organisation_id=o.id and o.slug='madhouse-gym' and p.name='Yearly Membership';

create table if not exists public.club_membership_join_provider_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  join_request_id uuid not null,
  provider_type text not null,
  provider_event_key text not null,
  event_type text not null check(event_type in ('upfront_confirmed','upfront_failed','mandate_confirmed','mandate_failed')),
  amount_minor integer,
  provider_reference text,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(organisation_id,provider_type,provider_event_key),
  foreign key(join_request_id,organisation_id) references public.club_membership_join_requests(id,organisation_id) on delete cascade
);
alter table public.club_membership_join_provider_events enable row level security;
revoke all on table public.club_membership_join_provider_events from public,anon,authenticated;

alter table public.club_membership_billing_arrangements
  add column if not exists billing_anchor_day integer check(billing_anchor_day is null or billing_anchor_day between 1 and 31);

create or replace function public.club_membership_anniversary(p_from timestamptz,p_anchor_day integer,p_months integer default 1)
returns timestamptz language plpgsql immutable set search_path=pg_catalog,public as $$
declare base_date date; last_date date; target_date date; clock_time time;
begin
  if p_anchor_day not between 1 and 31 or p_months<1 then raise exception 'Invalid billing anniversary' using errcode='22023'; end if;
  base_date:=(date_trunc('month',p_from at time zone 'UTC')+make_interval(months=>p_months))::date;
  last_date:=(base_date+interval '1 month'-interval '1 day')::date;
  target_date:=base_date+(least(p_anchor_day,extract(day from last_date)::integer)-1);
  clock_time:=(p_from at time zone 'UTC')::time;
  return (target_date+clock_time) at time zone 'UTC';
end; $$;

create or replace function public.club_normalise_billing_anniversary()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare anchor integer;
begin
  anchor:=coalesce(new.billing_anchor_day,extract(day from new.next_due_at at time zone 'UTC')::integer);
  new.billing_anchor_day:=anchor;
  if tg_op='UPDATE' and new.next_due_at is distinct from old.next_due_at and new.frequency='monthly' then
    new.next_due_at:=public.club_membership_anniversary(old.next_due_at,anchor,1);
  end if;
  return new;
end; $$;
drop trigger if exists club_billing_arrangement_anniversary on public.club_membership_billing_arrangements;
create trigger club_billing_arrangement_anniversary before insert or update of next_due_at on public.club_membership_billing_arrangements
for each row execute function public.club_normalise_billing_anniversary();
revoke all on function public.club_membership_anniversary(timestamptz,integer,integer),public.club_normalise_billing_anniversary() from public,anon,authenticated;

create or replace function public.club_monthly_grace_only()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare anchor integer;
begin
  if new.arrangement_id is not null and new.frequency='monthly' then
    select billing_anchor_day into anchor from public.club_membership_billing_arrangements where id=new.arrangement_id and organisation_id=new.organisation_id;
    if anchor is not null then
      new.next_due_at:=public.club_membership_anniversary(new.next_due_at-interval '1 month',anchor,1);
      new.period_key:=to_char(new.next_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
  end if;
  if new.frequency<>'monthly' and new.state='grace' then new.state:='failed'; new.grace_started_at:=null; end if;
  return new;
end; $$;
drop trigger if exists club_billing_monthly_grace_only on public.club_membership_billing_obligations;
create trigger club_billing_monthly_grace_only before insert or update on public.club_membership_billing_obligations
for each row execute function public.club_monthly_grace_only();
revoke all on function public.club_monthly_grace_only() from public,anon,authenticated;
update public.club_membership_billing_obligations set state='failed',grace_started_at=null where frequency<>'monthly' and state='grace';
update public.club_membership_payment_access_suspensions s set active=false,cleared_at=coalesce(cleared_at,now())
where active and exists(select 1 from public.club_membership_billing_obligations o where o.id=s.obligation_id and o.frequency<>'monthly');

create or replace function public.club_list_joinable_memberships(p_organisation_id uuid)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',p.id,'organisation_id',p.organisation_id,'name',p.name,'kind',p.kind,'price_minor',p.price_minor,
    'currency',p.currency,'billing',p.billing,'duration_days',p.duration_days,'sellable',p.sellable,
    'joining_fee_minor',case when p.billing='recurring' then coalesce(charges.joining_fee_minor,0) else 0 end,
    'joining_fee_configured',case when p.billing='recurring' then coalesce(charges.configured,false) else true end,
    'checkout_kind',case when p.price_minor=0 then 'free' when p.billing='recurring' then 'monthly_recurring'
      when p.duration_days=1 then 'day_pass' when p.duration_days=7 then 'week_pass'
      when p.duration_days>=365 then 'annual_one_off' else 'one_off' end
  )
  from public.club_products p
  join public.club_organisations o on o.id=p.organisation_id and o.active and o.member_joinable
  left join lateral (
    select sum(c.amount_minor)::integer joining_fee_minor,count(*)>0 configured from public.club_membership_initial_charges c
    where c.organisation_id=p.organisation_id and c.product_id=p.id and c.charge_type='joining_fee' and c.required and c.active
  ) charges on true
  where p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null
  order by p.name;
$$;
revoke all on function public.club_list_joinable_memberships(uuid) from public,anon,authenticated;
grant execute on function public.club_list_joinable_memberships(uuid) to anon,authenticated;

create or replace function public.club_start_membership_joining(
  p_organisation_id uuid,p_product_id uuid,p_location_id uuid,p_first_name text,p_last_name text,
  p_email text,p_phone text,p_date_of_birth date,p_address_line_1 text,p_address_line_2 text,
  p_town_city text,p_postcode text,p_emergency_name text,p_emergency_phone text,
  p_terms_accepted boolean,p_privacy_accepted boolean,p_marketing_consent boolean,
  p_payment_method text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user uuid:=auth.uid(); v_auth record; v_customer public.club_customers%rowtype;
  v_product public.club_products%rowtype; v_request public.club_membership_join_requests%rowtype;
  v_status text; v_payment_state text; v_method text; v_checkout text; v_slug text;
  v_joining_fee integer:=0; v_first_period integer:=0; v_upfront integer:=0; v_fee_configured boolean:=false;
begin
  if v_user is null then raise exception 'Sign in to start joining' using errcode='42501'; end if;
  select lower(btrim(email)) email,email_confirmed_at into v_auth from auth.users where id=v_user;
  if v_auth.email_confirmed_at is null then raise exception 'Confirm your email before joining' using errcode='42501'; end if;
  if v_auth.email is distinct from lower(btrim(p_email)) then raise exception 'Joining email must match the signed-in account' using errcode='42501'; end if;
  if nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null or nullif(btrim(p_phone),'') is null
    or p_date_of_birth is null or p_date_of_birth>=current_date or nullif(btrim(p_address_line_1),'') is null
    or nullif(btrim(p_postcode),'') is null or nullif(btrim(p_emergency_name),'') is null
    or nullif(btrim(p_emergency_phone),'') is null or not coalesce(p_terms_accepted,false)
    or not coalesce(p_privacy_accepted,false) or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Joining details are incomplete' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_locations where id=p_location_id and organisation_id=p_organisation_id and active) then raise exception 'Venue is unavailable' using errcode='22023'; end if;
  select p,o.slug into v_product,v_slug from public.club_products p join public.club_organisations o on o.id=p.organisation_id
    where p.id=p_product_id and p.organisation_id=p_organisation_id and p.kind='membership' and p.sellable and p.archived_at is null and o.active and o.member_joinable;
  if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
  v_checkout:=case when v_product.price_minor=0 then 'free' when v_product.billing='recurring' then 'monthly_recurring'
    when v_product.duration_days=1 then 'day_pass' when v_product.duration_days=7 then 'week_pass'
    when v_product.duration_days>=365 then 'annual_one_off' else 'one_off' end;
  if v_checkout='monthly_recurring' then
    select coalesce(sum(amount_minor),0)::integer,count(*)>0 into v_joining_fee,v_fee_configured from public.club_membership_initial_charges
      where organisation_id=p_organisation_id and product_id=v_product.id and charge_type='joining_fee' and required and active;
    if v_slug='madhouse-gym' and not v_fee_configured then raise exception 'Monthly joining fee is not configured' using errcode='55000'; end if;
  end if;
  v_first_period:=case when v_product.price_minor=0 then 0 else v_product.price_minor end;
  v_upfront:=v_joining_fee+v_first_period;
  v_method:=case when v_checkout='free' then 'none' when v_checkout='monthly_recurring' then 'card_and_direct_debit'
    when v_slug='madhouse-gym' then 'card' else coalesce(nullif(p_payment_method,''),'card') end;
  if v_method not in ('none','card','direct_debit','card_and_direct_debit','staff_manual') then raise exception 'Choose a valid payment route' using errcode='22023'; end if;
  select * into v_customer from public.club_customers where organisation_id=p_organisation_id and user_id=v_user for update;
  if not found then
    if exists(select 1 from public.club_customers where organisation_id=p_organisation_id and lower(btrim(email))=v_auth.email and user_id is distinct from v_user) then raise exception 'An existing member record matches this email; claim it instead' using errcode='23505'; end if;
    insert into public.club_customers(organisation_id,user_id,display_name,email,phone,status)
      values(p_organisation_id,v_user,btrim(p_first_name)||' '||btrim(p_last_name),v_auth.email,btrim(p_phone),'customer') returning * into v_customer;
  end if;
  update public.club_customers set display_name=btrim(p_first_name)||' '||btrim(p_last_name),email=v_auth.email,phone=btrim(p_phone),
    first_name=btrim(p_first_name),last_name=btrim(p_last_name),date_of_birth=p_date_of_birth,address_line_1=btrim(p_address_line_1),
    address_line_2=nullif(btrim(p_address_line_2),''),town_city=nullif(btrim(p_town_city),''),postcode=upper(btrim(p_postcode)),
    emergency_contact_name=btrim(p_emergency_name),emergency_contact_phone=btrim(p_emergency_phone),
    terms_accepted_at=coalesce(terms_accepted_at,now()),privacy_accepted_at=coalesce(privacy_accepted_at,now()),
    marketing_consent=coalesce(p_marketing_consent,false),marketing_consent_at=case when p_marketing_consent then now() else null end,updated_at=now()
    where id=v_customer.id returning * into v_customer;
  insert into public.profiles(id,email,display_name,first_name,last_name) values(v_user,v_auth.email,v_customer.display_name,btrim(p_first_name),btrim(p_last_name))
    on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name;
  insert into public.club_members(organisation_id,user_id,role,active,preferred_location_id) values(p_organisation_id,v_user,'member',true,p_location_id)
    on conflict(organisation_id,user_id) do update set active=true,preferred_location_id=excluded.preferred_location_id;
  select * into v_request from public.club_membership_join_requests where organisation_id=p_organisation_id and user_id=v_user and status not in ('completed','cancelled') for update;
  v_status:=case when v_checkout='free' then 'ready_to_activate' when v_method='staff_manual' then 'staff_review' else 'payment_required' end;
  v_payment_state:=case when v_checkout='free' then 'not_required' when v_method='staff_manual' then 'pending' else 'unavailable' end;
  if found then
    update public.club_membership_join_requests set customer_id=v_customer.id,product_id=v_product.id,location_id=p_location_id,status=v_status,
      payment_method=v_method,payment_state=v_payment_state,payment_provider=case when v_method in ('card','card_and_direct_debit') then 'stripe' when v_method='direct_debit' then 'gocardless' end,
      checkout_kind=v_checkout,joining_fee_minor=v_joining_fee,first_period_minor=v_first_period,upfront_amount_minor=v_upfront,
      upfront_provider=case when v_checkout='free' then null else 'stripe' end,upfront_payment_state=case when v_checkout='free' then 'not_required' else 'unavailable' end,
      recurring_provider=case when v_checkout='monthly_recurring' then 'gocardless' end,
      recurring_authority_state=case when v_checkout='monthly_recurring' then 'unavailable' else 'not_required' end,
      billing_anchor_day=case when v_checkout='monthly_recurring' then extract(day from current_date)::integer end,
      paid_through_at=null,payment_failure_reason=null,last_activity_at=now(),reminder_eligible_at=case when v_upfront>0 then now()+interval '24 hours' end,updated_at=now()
      where id=v_request.id returning * into v_request;
  else
    insert into public.club_membership_join_requests(organisation_id,user_id,customer_id,product_id,location_id,status,idempotency_key,payment_method,payment_state,payment_provider,last_activity_at,reminder_eligible_at,
      checkout_kind,joining_fee_minor,first_period_minor,upfront_amount_minor,upfront_provider,upfront_payment_state,recurring_provider,recurring_authority_state,billing_anchor_day)
    values(p_organisation_id,v_user,v_customer.id,v_product.id,p_location_id,v_status,btrim(p_idempotency_key),v_method,v_payment_state,
      case when v_method in ('card','card_and_direct_debit') then 'stripe' when v_method='direct_debit' then 'gocardless' end,now(),case when v_upfront>0 then now()+interval '24 hours' end,
      v_checkout,v_joining_fee,v_first_period,v_upfront,case when v_checkout='free' then null else 'stripe' end,case when v_checkout='free' then 'not_required' else 'unavailable' end,
      case when v_checkout='monthly_recurring' then 'gocardless' end,case when v_checkout='monthly_recurring' then 'unavailable' else 'not_required' end,
      case when v_checkout='monthly_recurring' then extract(day from current_date)::integer end) returning * into v_request;
  end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before)
    values(p_organisation_id,v_user,v_request.id,case when v_upfront>0 then 'billing' else 'member_service' end,'join_incomplete','unavailable','join-reminder:'||v_request.id,coalesce(v_request.reminder_eligible_at,now()+interval '24 hours'))
    on conflict(organisation_id,idempotency_key) do nothing;
  return jsonb_build_object('request',to_jsonb(v_request),'customer',to_jsonb(v_customer),'product',to_jsonb(v_product));
end; $$;
revoke all on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.club_start_membership_joining(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,boolean,text,text) to authenticated;

create or replace function public.club_get_my_join_state(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select j.*,p.name product_name,p.price_minor,p.currency,p.billing,l.name location_name into r
    from public.club_membership_join_requests j join public.club_products p on p.id=j.product_id left join public.club_locations l on l.id=j.location_id
    where j.organisation_id=p_organisation_id and j.user_id=auth.uid() order by j.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_method',r.payment_method,
    'payment_provider',r.payment_provider,'product_name',r.product_name,'price_minor',r.price_minor,'currency',r.currency,
    'billing',r.billing,'location_name',r.location_name,'membership_id',r.membership_id,'updated_at',r.updated_at,
    'checkout_kind',r.checkout_kind,'joining_fee_minor',r.joining_fee_minor,'first_period_minor',r.first_period_minor,
    'upfront_amount_minor',r.upfront_amount_minor,'upfront_payment_state',r.upfront_payment_state,
    'recurring_authority_state',r.recurring_authority_state,'paid_through_at',r.paid_through_at);
end; $$;
revoke all on function public.club_get_my_join_state(uuid) from public,anon;
grant execute on function public.club_get_my_join_state(uuid) to authenticated;

create or replace function public.club_retry_join_payment(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype;
begin
  select * into r from public.club_membership_join_requests where id=p_request_id and user_id=auth.uid() for update;
  if not found or r.payment_method not in ('card','direct_debit','card_and_direct_debit') or r.status not in ('payment_required','payment_failed','retry_required') then raise exception 'Payment retry is unavailable' using errcode='42501'; end if;
  update public.club_membership_join_requests set status='payment_required',payment_state='unavailable',
    upfront_payment_state=case when upfront_payment_state='confirmed' then 'confirmed' else 'unavailable' end,
    recurring_authority_state=case when recurring_authority_state in ('not_required','confirmed') then recurring_authority_state else 'unavailable' end,
    payment_failure_reason=null,last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'status',r.status,'payment_state',r.payment_state,'payment_provider',r.payment_provider,
    'upfront_payment_state',r.upfront_payment_state,'recurring_authority_state',r.recurring_authority_state);
end; $$;
revoke all on function public.club_retry_join_payment(uuid) from public,anon;
grant execute on function public.club_retry_join_payment(uuid) to authenticated;

create or replace function public.club_record_join_provider_event(p_request_id uuid,p_provider_type text,p_provider_event_key text,p_event_type text,p_amount_minor integer,p_provider_reference text,p_occurred_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_membership_join_requests%rowtype; p public.club_products%rowtype; m public.club_memberships%rowtype; existing public.club_membership_join_provider_events%rowtype; v_end timestamptz; v_next timestamptz;
begin
  if nullif(btrim(p_provider_event_key),'') is null or p_event_type not in ('upfront_confirmed','upfront_failed','mandate_confirmed','mandate_failed') then raise exception 'Invalid join provider event' using errcode='22023'; end if;
  select * into r from public.club_membership_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request not found' using errcode='P0002'; end if;
  select * into existing from public.club_membership_join_provider_events where organisation_id=r.organisation_id and provider_type=p_provider_type and provider_event_key=p_provider_event_key;
  if found then return jsonb_build_object('event',to_jsonb(existing),'request',to_jsonb(r)); end if;
  if p_event_type like 'upfront_%' and (p_provider_type<>'stripe' or p_amount_minor is distinct from r.upfront_amount_minor) then raise exception 'Upfront payment does not match the join request' using errcode='22023'; end if;
  if p_event_type like 'mandate_%' and (r.checkout_kind<>'monthly_recurring' or p_provider_type<>'gocardless') then raise exception 'Recurring authority is not required for this join' using errcode='22023'; end if;
  if p_event_type in ('upfront_confirmed','mandate_confirmed') and nullif(btrim(p_provider_reference),'') is null then raise exception 'Provider confirmation reference is required' using errcode='22023'; end if;
  insert into public.club_membership_join_provider_events(organisation_id,join_request_id,provider_type,provider_event_key,event_type,amount_minor,provider_reference,occurred_at)
    values(r.organisation_id,r.id,p_provider_type,p_provider_event_key,p_event_type,p_amount_minor,nullif(btrim(p_provider_reference),''),coalesce(p_occurred_at,now())) returning * into existing;
  if p_event_type='upfront_confirmed' then update public.club_membership_join_requests set upfront_payment_state='confirmed',payment_failure_reason=null,updated_at=now() where id=r.id;
  elsif p_event_type='upfront_failed' then update public.club_membership_join_requests set upfront_payment_state='failed',payment_state='failed',status='payment_failed',payment_failure_reason='Upfront card payment failed',updated_at=now() where id=r.id;
  elsif p_event_type='mandate_confirmed' then update public.club_membership_join_requests set recurring_authority_state='confirmed',recurring_authority_reference=p_provider_reference,payment_failure_reason=null,updated_at=now() where id=r.id;
  else update public.club_membership_join_requests set recurring_authority_state='failed',payment_state='failed',status='payment_failed',payment_failure_reason='Direct Debit mandate setup failed',updated_at=now() where id=r.id; end if;
  select * into r from public.club_membership_join_requests where id=r.id;
  if r.upfront_payment_state='confirmed' and (r.checkout_kind<>'monthly_recurring' or r.recurring_authority_state='confirmed') and r.membership_id is null then
    select * into p from public.club_products where id=r.product_id and organisation_id=r.organisation_id and sellable and archived_at is null;
    if not found then raise exception 'Membership product is unavailable' using errcode='22023'; end if;
    v_end:=case when r.checkout_kind='monthly_recurring' then null when p.duration_days is not null then coalesce(p_occurred_at,now())+make_interval(days=>p.duration_days) end;
    insert into public.club_memberships(organisation_id,product_id,status,starts_at,ends_at,source,assignment_idempotency_key)
      values(r.organisation_id,p.id,'active',coalesce(p_occurred_at,now()),v_end,'purchase','join:'||r.id) returning * into m;
    insert into public.club_membership_holders(id,membership_id,organisation_id,user_id) values(gen_random_uuid(),m.id,r.organisation_id,r.user_id);
    insert into public.club_entitlement_grants(user_id,organisation_id,membership_id,entitlement_key,scope,location_ids,allowance_quantity,allowance_period,discount_percent,discount_period,discount_max_uses,starts_at,ends_at,source)
      select r.user_id,m.organisation_id,m.id,e.entitlement_key,e.scope,coalesce(e.location_ids,'{}'),e.allowance_quantity,e.allowance_period,e.discount_percent,e.discount_period,e.discount_max_uses,m.starts_at,m.ends_at,m.source from public.club_product_entitlements e where e.product_id=p.id;
    if r.checkout_kind='monthly_recurring' then
      v_next:=public.club_membership_anniversary(coalesce(p_occurred_at,now()),r.billing_anchor_day,1);
      insert into public.club_membership_billing_arrangements(organisation_id,membership_id,user_id,customer_id,provider_type,payment_method_family,provider_subscription_reference,amount_minor,currency,frequency,next_due_at,billing_anchor_day,last_successful_payment_at)
        values(r.organisation_id,m.id,r.user_id,r.customer_id,'gocardless','direct_debit',r.recurring_authority_reference,r.first_period_minor,p.currency,'monthly',v_next,r.billing_anchor_day,coalesce(p_occurred_at,now()));
    end if;
    update public.club_membership_join_requests set membership_id=m.id,status='active',payment_state='confirmed',paid_through_at=v_end,completed_at=now(),last_activity_at=now(),updated_at=now() where id=r.id returning * into r;
    update public.club_member_notification_intents set state='cancelled' where join_request_id=r.id and template_key='join_incomplete';
    if r.checkout_kind='annual_one_off' and v_end is not null then
      insert into public.club_member_notification_intents(organisation_id,user_id,join_request_id,category,template_key,state,idempotency_key,not_before) values
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_1_month','unavailable','annual-renewal-month:'||r.id,v_end-interval '1 month'),
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_1_week','unavailable','annual-renewal-week:'||r.id,v_end-interval '7 days'),
        (r.organisation_id,r.user_id,r.id,'billing','annual_renewal_final_days','unavailable','annual-renewal-final:'||r.id,v_end-interval '3 days')
      on conflict(organisation_id,idempotency_key) do nothing;
    end if;
  end if;
  return jsonb_build_object('event',to_jsonb(existing),'request',to_jsonb(r),'membership_id',r.membership_id);
end; $$;
revoke all on function public.club_record_join_provider_event(uuid,text,text,text,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.club_record_join_provider_event(uuid,text,text,text,integer,text,timestamptz) to service_role;

create table if not exists public.user_tutorial_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  tutorial_key text not null check(tutorial_key in ('member_core','madhouse_connected','coach_core')),
  version integer not null check(version>0),
  status text not null check(status in ('completed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,tutorial_key,version)
);
alter table public.user_tutorial_progress enable row level security;
revoke all on table public.user_tutorial_progress from public,anon,authenticated;
grant select on table public.user_tutorial_progress to authenticated;
drop policy if exists user_tutorial_progress_subject_read on public.user_tutorial_progress;
create policy user_tutorial_progress_subject_read on public.user_tutorial_progress for select to authenticated using(user_id=auth.uid());

create or replace function public.r12_get_my_tutorial_context()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'member_ready',exists(select 1 from public.profiles p where p.id=auth.uid() and coalesce(nullif(btrim(p.first_name),''),nullif(btrim(p.display_name),''),nullif(btrim(p.email),'')) is not null),
    'madhouse_connected',exists(select 1 from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_organisations o on o.id=m.organisation_id where h.user_id=auth.uid() and o.slug='madhouse-gym'),
    'coach_ready',exists(select 1 from public.coach_permissions cp where cp.user_id=auth.uid() and cp.active),
    'progress',coalesce((select jsonb_agg(jsonb_build_object('tutorial_key',t.tutorial_key,'version',t.version,'status',t.status,'finished_at',t.finished_at)) from public.user_tutorial_progress t where t.user_id=auth.uid()),'[]'::jsonb)
  ) where auth.uid() is not null;
$$;

create or replace function public.r12_save_my_tutorial_progress(p_tutorial_key text,p_version integer,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.user_tutorial_progress%rowtype;
begin
  if auth.uid() is null or p_version<1 or p_status not in ('completed','skipped') or p_tutorial_key not in ('member_core','madhouse_connected','coach_core') then raise exception 'Tutorial progress is invalid' using errcode='22023'; end if;
  if p_tutorial_key='coach_core' and not exists(select 1 from public.coach_permissions where user_id=auth.uid() and active) then raise exception 'Coach tutorial is unavailable' using errcode='42501'; end if;
  if p_tutorial_key='madhouse_connected' and not exists(select 1 from public.club_membership_holders h join public.club_memberships m on m.id=h.membership_id join public.club_organisations o on o.id=m.organisation_id where h.user_id=auth.uid() and o.slug='madhouse-gym') then raise exception 'Madhouse introduction is unavailable' using errcode='42501'; end if;
  if p_tutorial_key='member_core' and not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Member tutorial is unavailable' using errcode='42501'; end if;
  insert into public.user_tutorial_progress(user_id,tutorial_key,version,status) values(auth.uid(),p_tutorial_key,p_version,p_status)
  on conflict(user_id,tutorial_key,version) do update set status=excluded.status,finished_at=now(),updated_at=now() returning * into result;
  return to_jsonb(result);
end; $$;
revoke all on function public.r12_get_my_tutorial_context(),public.r12_save_my_tutorial_progress(text,integer,text) from public,anon;
grant execute on function public.r12_get_my_tutorial_context(),public.r12_save_my_tutorial_progress(text,integer,text) to authenticated;


-- === APPLY supabase/migrations/2026-11-20-club-venue-checks-maintenance.sql ===
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


-- === APPLY supabase/migrations/2026-11-21-notification-engine.sql ===
-- Durable, provider-neutral transactional notification outbox.
-- Delivery is deliberately separate from membership/access authority.

alter table public.club_member_notification_intents
  alter column user_id drop not null,
  add column if not exists target_email text,
  add column if not exists sender_purpose text not null default 'members',
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists related_type text,
  add column if not exists related_id uuid,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists claimed_by text,
  add column if not exists claimed_until timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists reminder_number integer not null default 1;

alter table public.club_member_notification_intents drop constraint if exists club_member_notification_intents_category_check;
alter table public.club_member_notification_intents add constraint club_member_notification_intents_category_check check (category in ('member_service','billing','staff','maintenance'));
alter table public.club_member_notification_intents drop constraint if exists club_member_notification_intents_state_check;
alter table public.club_member_notification_intents add constraint club_member_notification_intents_state_check check (state in ('pending','scheduled','processing','unavailable','sent','failed','cancelled'));
alter table public.club_member_notification_intents drop constraint if exists club_member_notification_intents_sender_purpose_check;
alter table public.club_member_notification_intents add constraint club_member_notification_intents_sender_purpose_check check (sender_purpose in ('members','billing','staff'));
update public.club_member_notification_intents n set target_email=u.email, updated_at=now()
from auth.users u where u.id=n.user_id and n.target_email is null;
update public.club_member_notification_intents set idempotency_key=idempotency_key||':1', reminder_number=1
where template_key='join_incomplete' and idempotency_key not like '%:1' and idempotency_key not like '%:2';
update public.club_member_notification_intents set sender_purpose=case when category='billing' then 'billing' else 'members' end;
create index if not exists club_member_notification_intents_due_idx on public.club_member_notification_intents(state,not_before,claimed_until);
create index if not exists club_member_notification_intents_related_idx on public.club_member_notification_intents(organisation_id,related_type,related_id);
revoke all on table public.club_member_notification_intents from public,anon,authenticated;

create or replace function public.club_queue_staff_invitation_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.club_member_notification_intents(
    organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,
    sender_purpose,payload,related_type,related_id
  ) values(
    new.organisation_id,null,new.email_normalized,'staff','staff_invitation','pending',
    'staff-invitation:'||new.id,now(),'staff',jsonb_build_object(
      'grantId',new.id,'email',new.email_normalized,'name',new.display_name,
      'role',new.intended_role,'organisationName',(select name from public.club_organisations where id=new.organisation_id)
    ),'staff_access_grant',new.id
  ) on conflict (organisation_id,idempotency_key) do update set
    target_email=excluded.target_email,payload=excluded.payload,updated_at=now()
    where public.club_member_notification_intents.state not in ('sent','processing');
  return new;
end; $$;
drop trigger if exists club_staff_grant_notification on public.club_staff_access_grants;
create trigger club_staff_grant_notification after insert on public.club_staff_access_grants
for each row execute function public.club_queue_staff_invitation_notification();

create or replace function public.club_cancel_staff_invitation_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status in ('revoked','expired') then
    update public.club_member_notification_intents set state='cancelled',updated_at=now()
    where organisation_id=new.organisation_id and related_type='staff_access_grant' and related_id=new.id
      and state in ('pending','scheduled','failed','unavailable');
  end if;
  return new;
end; $$;
drop trigger if exists club_staff_grant_notification_cancel on public.club_staff_access_grants;
create trigger club_staff_grant_notification_cancel after update of status on public.club_staff_access_grants
for each row execute function public.club_cancel_staff_invitation_notification();

create or replace function public.club_resend_staff_invitation(p_organisation_id uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g public.club_staff_access_grants%rowtype; n public.club_member_notification_intents%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage') then raise exception 'Staff invitation management is not permitted' using errcode='42501'; end if;
  select * into g from public.club_staff_access_grants where id=p_grant_id and organisation_id=p_organisation_id and status='pending' and expires_at>now() for share;
  if not found then raise exception 'Pending staff invitation not found' using errcode='P0002'; end if;
  update public.club_member_notification_intents set state='pending',not_before=now(),failure_code=null,failure_message=null,claimed_by=null,claimed_until=null,updated_at=now()
    where organisation_id=p_organisation_id and related_type='staff_access_grant' and related_id=g.id and state not in ('processing','cancelled') returning * into n;
  if n.id is null then raise exception 'Staff invitation notification not found' using errcode='P0002'; end if;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    select p_organisation_id,auth.uid(),m.role,'staff.invitation_resent','staff_access_grant',g.id,jsonb_build_object('notification_id',n.id)
    from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active;
  return jsonb_build_object('id',n.id,'state',n.state);
end; $$;
revoke all on function public.club_resend_staff_invitation(uuid,uuid) from public,anon;
grant execute on function public.club_resend_staff_invitation(uuid,uuid) to authenticated;

create or replace function public.club_list_staff_invitation_notifications(p_organisation_id uuid)
returns table(grant_id uuid,state text,attempts integer,last_attempt_at timestamptz,sent_at timestamptz,failure_code text)
language sql stable security definer set search_path=pg_catalog,public as $$
  select n.related_id,n.state,n.attempts,n.last_attempt_at,n.sent_at,n.failure_code
  from public.club_member_notification_intents n
  where n.organisation_id=p_organisation_id and n.related_type='staff_access_grant'
    and public.club_capability_allowed(p_organisation_id,auth.uid(),'staff.permissions_manage');
$$;
revoke all on function public.club_list_staff_invitation_notifications(uuid) from public,anon;
grant execute on function public.club_list_staff_invitation_notifications(uuid) to authenticated;

create or replace function public.club_queue_member_activation_notification(p_organisation_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.club_customers%rowtype; n public.club_member_notification_intents%rowtype; actor_role text;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'members.link_account') then raise exception 'Member activation notification is not permitted' using errcode='42501'; end if;
  select * into c from public.club_customers where id=p_customer_id and organisation_id=p_organisation_id for share;
  if not found or nullif(btrim(c.email),'') is null or c.user_id is not null then raise exception 'Member activation is not eligible' using errcode='22023'; end if;
  insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    values(p_organisation_id,null,lower(btrim(c.email)),'member_service','member_activation','pending','member-activation:'||c.id,now(),'members',jsonb_build_object('name',c.display_name,'customerId',c.id),'customer',c.id)
    on conflict(organisation_id,idempotency_key) do update set target_email=excluded.target_email,payload=excluded.payload,updated_at=now() returning * into n;
  select role into actor_role from public.club_members where organisation_id=p_organisation_id and user_id=auth.uid() and active;
  insert into public.club_audit_events(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata)
    values(p_organisation_id,auth.uid(),actor_role,'member.activation_notification_queued','customer',c.id,jsonb_build_object('notification_id',n.id));
  return jsonb_build_object('id',n.id,'state',n.state);
end; $$;
revoke all on function public.club_queue_member_activation_notification(uuid,uuid) from public,anon;
grant execute on function public.club_queue_member_activation_notification(uuid,uuid) to authenticated;

create or replace function public.club_claim_notification_intents(p_limit integer,p_worker_id text)
returns setof public.club_member_notification_intents language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;
  return query
    with candidates as (
      select id from public.club_member_notification_intents
      where target_email is not null and state in ('pending','scheduled','failed')
        and not_before<=now() and (claimed_until is null or claimed_until<now())
      order by not_before,created_at limit greatest(1,least(coalesce(p_limit,25),100)) for update skip locked
    )
    update public.club_member_notification_intents n set state='processing',attempts=n.attempts+1,
      last_attempt_at=now(),claimed_by=p_worker_id,claimed_until=now()+interval '10 minutes',updated_at=now()
    from candidates c where n.id=c.id returning n.*;
end; $$;
revoke all on function public.club_claim_notification_intents(integer,text) from public,anon,authenticated;
grant execute on function public.club_claim_notification_intents(integer,text) to service_role;

create or replace function public.club_complete_notification_intent(p_id uuid,p_provider_reference text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Notification worker requires service role' using errcode='42501'; end if;
  update public.club_member_notification_intents set state='sent',provider_reference=p_provider_reference,sent_at=now(),claimed_until=null,updated_at=now() where id=p_id and state='processing';
end; $$;
revoke all on function public.club_complete_notification_intent(uuid,text) from public,anon,authenticated;
grant execute on function public.club_complete_notification_intent(uuid,text) to service_role;

create or replace function public.club_fail_notification_intent(p_id uuid,p_code text,p_message text,p_retry_at timestamptz,p_terminal_state text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()<>'service_role' or p_terminal_state not in ('failed','unavailable') then raise exception 'Invalid notification failure' using errcode='42501'; end if;
  update public.club_member_notification_intents set state=case when p_retry_at is null then p_terminal_state else 'scheduled' end,
    not_before=coalesce(p_retry_at,not_before),failure_code=left(p_code,120),failure_message=left(p_message,500),claimed_until=null,updated_at=now() where id=p_id and state='processing';
end; $$;
revoke all on function public.club_fail_notification_intent(uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.club_fail_notification_intent(uuid,text,text,timestamptz,text) to service_role;

-- Materialise provider-neutral intents from durable domain state. This function is
-- service-role only so browser input cannot choose recipients, templates, or senders.
create or replace function public.club_generate_notification_intents()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o record; b record; d record; i record; u record; created integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Notification generation requires service role' using errcode='42501'; end if;
  -- Existing join intent becomes the first bounded reminder only when due.
  update public.club_member_notification_intents n set state='pending',updated_at=now()
  from public.club_membership_join_requests r
  where n.join_request_id=r.id and n.template_key='join_incomplete' and n.state='unavailable'
    and n.not_before<=now() and r.status not in ('completed','cancelled');
  insert into public.club_member_notification_intents(
    organisation_id,user_id,target_email,join_request_id,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,reminder_number
  )
  select r.organisation_id,r.user_id,u.email,r.id,case when r.payment_state in ('payment_required','payment_pending','payment_failed','retry_required') then 'billing' else 'member_service' end,
    'join_incomplete','pending','join-reminder:'||r.id||':2',now(),case when r.payment_state in ('payment_required','payment_pending','payment_failed','retry_required') then 'billing' else 'members' end,jsonb_build_object('name','there','organisationId',r.organisation_id),2
  from public.club_membership_join_requests r join auth.users u on u.id=r.user_id
  where r.status not in ('completed','cancelled') and r.last_activity_at<=now()-interval '72 hours'
    and not exists(select 1 from public.club_member_notification_intents n where n.organisation_id=r.organisation_id and n.idempotency_key='join-reminder:'||r.id||':2')
    and exists(select 1 from public.club_member_notification_intents n where n.join_request_id=r.id and n.template_key='join_incomplete' and n.state='sent');
  -- Existing annual reminder intents become deliverable only when due.
  update public.club_member_notification_intents set state='pending',sender_purpose='billing',updated_at=now()
  where category='billing' and template_key in ('annual_renewal_1_month','annual_renewal_1_week','annual_renewal_final_days')
    and state='unavailable' and not_before<=now();
  -- Monthly dunning only; non-recurring products never enter this branch.
  for o in select o.*,a.frequency from public.club_membership_billing_obligations o join public.club_membership_billing_arrangements a on a.id=o.arrangement_id and a.organisation_id=o.organisation_id where o.state in ('failed','grace','retry_scheduled') and a.frequency='monthly' loop
    select email into u from auth.users where id=o.user_id;
    if u.email is not null then
      insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(o.organisation_id,o.user_id,u.email,'billing','monthly_payment_failed','pending','monthly-payment-failed:'||o.id,now(),'billing',jsonb_build_object('name','there','organisationId',o.organisation_id,'obligationId',o.id),'billing_obligation',o.id) on conflict(organisation_id,idempotency_key) do nothing;
      created:=created+1;
    end if;
  end loop;
  -- Upcoming booked inductions receive one reminder, never a reminder for a cancelled booking.
  for b in select b.*,u.email from public.club_induction_bookings b join auth.users u on u.id=b.user_id where b.status='booked' and b.starts_at between now() and now()+interval '24 hours' loop
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    values(b.organisation_id,b.user_id,b.email,'member_service','induction_reminder','pending','induction-reminder:'||b.id,b.starts_at,'members',jsonb_build_object('bookingId',b.id),'induction_booking',b.id) on conflict(organisation_id,idempotency_key) do nothing;
  end loop;
  -- Supplier collection events already have their own idempotent source event.
  for d in select e.*,u.email from public.club_notification_events e join auth.users u on u.id=e.user_id where e.event_type='order_ready_for_collection' and e.state='queued' loop
    insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
    values(d.organisation_id,d.user_id,d.email,'member_service','order_ready_for_collection','pending','order-ready:'||d.id,coalesce(d.scheduled_at,now()),'members',d.payload,'notification_event',d.id) on conflict(organisation_id,idempotency_key) do nothing;
  end loop;
  -- One alert per manager and unresolved issue; normal OK checks never enter here.
  for i in select i.*,l.name location_name,a.name asset_name from public.club_maintenance_issues i left join public.club_locations l on l.id=i.location_id and l.organisation_id=i.organisation_id left join public.club_equipment_assets a on a.id=i.asset_id and a.organisation_id=i.organisation_id where i.status not in ('resolved','closed') and (i.out_of_service or i.priority in ('high','urgent')) loop
    for u in select m.user_id,au.email from public.club_members m join auth.users au on au.id=m.user_id where m.organisation_id=i.organisation_id and m.active and m.role in ('owner','gym_admin') loop
      insert into public.club_member_notification_intents(organisation_id,user_id,target_email,category,template_key,state,idempotency_key,not_before,sender_purpose,payload,related_type,related_id)
      values(i.organisation_id,u.user_id,u.email,'maintenance','maintenance_escalation','pending','maintenance:'||i.id||':'||u.user_id,now(),'staff',jsonb_build_object('organisationId',i.organisation_id,'organisationName',(select name from public.club_organisations where id=i.organisation_id),'locationName',i.location_name,'assetName',i.asset_name,'priority',i.priority),'maintenance_issue',i.id) on conflict(organisation_id,idempotency_key) do nothing;
    end loop;
  end loop;
  update public.club_member_notification_intents n set state='cancelled',updated_at=now()
  where n.template_key in ('monthly_payment_failed','maintenance_escalation','annual_renewal_1_month','annual_renewal_1_week','annual_renewal_final_days') and n.state in ('pending','scheduled','failed','unavailable')
    and ((n.template_key='monthly_payment_failed' and not exists(select 1 from public.club_membership_billing_obligations o where o.id=n.related_id and o.state in ('failed','grace','retry_scheduled')))
      or (n.template_key='maintenance_escalation' and not exists(select 1 from public.club_maintenance_issues i where i.id=n.related_id and i.status not in ('resolved','closed') and (i.out_of_service or i.priority in ('high','urgent'))))
      or (n.template_key like 'annual_renewal%' and exists(select 1 from public.club_membership_join_requests r join public.club_memberships original on original.id=r.membership_id and original.organisation_id=r.organisation_id join public.club_membership_holders h on h.membership_id=original.id and h.user_id=r.user_id join public.club_memberships newer on newer.organisation_id=r.organisation_id and newer.starts_at>original.starts_at join public.club_membership_holders hn on hn.membership_id=newer.id and hn.user_id=h.user_id where r.id=n.join_request_id)));
  return jsonb_build_object('created',created);
end; $$;
revoke all on function public.club_generate_notification_intents() from public,anon,authenticated;
grant execute on function public.club_generate_notification_intents() to service_role;

-- === RECONCILIATION MARKER ===
insert into public.r12_schema_migrations(migration_name, checksum, source, note) values ('2026-11-22-madhouse-manual-reconciliation.sql', 'manual-sql-editor-bundle', 'manual-sql-editor', 'Reviewed single-paste reconciliation bundle') on conflict (migration_name) do update set applied_at = now(), source = excluded.source, note = excluded.note;
-- === READ-ONLY READINESS DIAGNOSTICS ===
select to_regclass('public.profiles') as profiles, to_regclass('public.club_organisations') as club_organisations, to_regclass('public.club_members') as club_members, to_regclass('public.club_customers') as club_customers, to_regclass('public.club_memberships') as club_memberships, to_regclass('public.club_orders') as club_orders, to_regclass('public.coach_permissions') as coach_permissions, to_regclass('public.club_checklist_cycles') as club_checklist_cycles, to_regclass('public.club_member_notification_intents') as club_member_notification_intents;
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('club_list_staff_accounts','club_create_staff_access_grant','club_claim_staff_access_grant','club_start_membership_joining','club_claim_existing_member','club_submit_daily_check','coach_has_access','club_claim_notification_intents') order by proname;
select migration_name, applied_at, source from public.r12_schema_migrations where migration_name = '2026-11-22-madhouse-manual-reconciliation.sql';
select count(*) as organisations from public.club_organisations;
select count(*) as club_members from public.club_members;
select count(*) as profiles from public.profiles;
select count(*) as coach_permissions from public.coach_permissions;
-- SCHEMA READY — RUN MADHOUSE BOOTSTRAP NEXT
