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
