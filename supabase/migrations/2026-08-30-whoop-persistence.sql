alter table if exists public.whoop_connections add column if not exists updated_at timestamptz not null default now();
alter table if exists public.whoop_connections add column if not exists last_sync_at timestamptz;
create unique index if not exists whoop_connections_user_id_key on public.whoop_connections (user_id);
alter table if exists public.whoop_connections enable row level security;
alter table if exists public.whoop_records enable row level security;
-- No browser policies are granted for token/record tables; server service-role routes enforce the authenticated user_id.
