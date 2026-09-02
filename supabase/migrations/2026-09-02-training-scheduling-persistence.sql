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
