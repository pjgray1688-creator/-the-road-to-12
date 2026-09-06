-- Allow authorised staff to void abandoned staff checkout orders without touching stock or payments.
create or replace function public.club_cancel_staff_pending_order(p_organisation_id uuid, p_order_id uuid)
returns public.club_orders
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.club_orders%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'payments.record_cash') then
    raise exception 'Order cancellation denied' using errcode='42501';
  end if;
  select * into r from public.club_orders where id=p_order_id and organisation_id=p_organisation_id for update;
  if not found or r.channel <> 'staff_checkout' or r.status <> 'pending_payment' then
    raise exception 'Order is not an abandoned staff checkout' using errcode='22023';
  end if;
  update public.club_orders set status='cancelled', updated_at=now() where id=r.id returning * into r;
  return r;
end; $$;
revoke all on function public.club_cancel_staff_pending_order(uuid,uuid) from public,anon;
grant execute on function public.club_cancel_staff_pending_order(uuid,uuid) to authenticated;
