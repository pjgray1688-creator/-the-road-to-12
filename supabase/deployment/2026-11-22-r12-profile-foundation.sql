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
