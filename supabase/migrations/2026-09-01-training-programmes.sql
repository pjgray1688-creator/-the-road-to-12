alter table if exists public.profiles add column if not exists training_profile jsonb;
alter table if exists public.profiles add column if not exists generated_programme jsonb;
alter table if exists public.profiles add column if not exists active_programme_id text;
