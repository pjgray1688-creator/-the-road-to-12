-- The background worker uses the Supabase service-role client.
grant execute on function public.club_run_supplier_import_job(uuid) to service_role;
