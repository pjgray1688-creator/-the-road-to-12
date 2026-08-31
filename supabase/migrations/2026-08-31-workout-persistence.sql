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
