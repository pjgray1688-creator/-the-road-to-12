alter table if exists public.whoop_connections add column if not exists updated_at timestamptz not null default now();
alter table if exists public.whoop_connections enable row level security;
alter table if exists public.whoop_records enable row level security;
-- No browser policies are granted for token/record tables; server service-role routes enforce the authenticated user_id.
