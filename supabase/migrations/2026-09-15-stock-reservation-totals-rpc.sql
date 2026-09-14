create or replace function public.club_list_stock_reservation_totals(p_organisation_id uuid, p_location_id uuid default null)
returns table(organisation_id uuid, location_id uuid, product_id uuid, reserved_quantity integer)
language sql security definer set search_path=pg_catalog,public as $$
  select r.organisation_id, r.location_id, r.product_id, sum(r.quantity)::integer
  from public.club_stock_reservations r
  where auth.uid() is not null
    and public.club_has_active_role(p_organisation_id, array['member','trainer','gym_staff','gym_admin','owner','guest'])
    and r.organisation_id = p_organisation_id
    and (p_location_id is null or r.location_id = p_location_id)
    and r.status = 'active'
  group by r.organisation_id, r.location_id, r.product_id
$$;
revoke all on function public.club_list_stock_reservation_totals(uuid,uuid) from public, anon;
grant execute on function public.club_list_stock_reservation_totals(uuid,uuid) to authenticated;
