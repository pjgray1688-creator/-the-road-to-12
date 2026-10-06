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

