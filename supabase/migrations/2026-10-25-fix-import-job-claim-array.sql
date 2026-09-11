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
