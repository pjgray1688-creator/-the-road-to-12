-- Fail closed until class pricing, verified payment, and package-authorised
-- included class credits are implemented together in one transactional flow.
-- Existing direct authenticated callers of the legacy booking RPC cannot
-- create a free confirmed booking after this migration is applied.
create or replace function public.club_create_class_booking(
  p_session_id uuid, p_customer_id uuid, p_status text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  raise exception 'Class booking is unavailable until verified payment and package entitlements are configured'
    using errcode='55000';
end; $$;

revoke all on function public.club_create_class_booking(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.club_create_class_booking(uuid,uuid,text) to authenticated;
