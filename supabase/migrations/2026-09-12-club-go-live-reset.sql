-- Explicit, staff-authorised preparation for opening trading.
-- This function is never called by import or application startup. It clears
-- operational history for one organisation while preserving catalogue data,
-- suppliers, pricing, users and product families.
create or replace function public.club_prepare_go_live(p_organisation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_orders integer;
  v_movements integer;
  v_supplier_demand integer;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id, auth.uid(), 'commerce.pricing_manage') then
    raise exception 'Go-live preparation is not permitted' using errcode = '42501';
  end if;

  delete from public.club_supplier_allocations where organisation_id = p_organisation_id;
  delete from public.club_supplier_receipt_lines where receipt_id in (select id from public.club_supplier_receipts where organisation_id = p_organisation_id);
  delete from public.club_supplier_receipts where organisation_id = p_organisation_id;
  delete from public.club_supplier_order_batch_lines where batch_id in (select id from public.club_supplier_order_batches where organisation_id = p_organisation_id);
  delete from public.club_supplier_order_batches where organisation_id = p_organisation_id;
  delete from public.club_supplier_demand where organisation_id = p_organisation_id;
  get diagnostics v_supplier_demand = row_count;

  delete from public.club_stock_movements where organisation_id = p_organisation_id;
  get diagnostics v_movements = row_count;
  delete from public.club_stocktakes where organisation_id = p_organisation_id;
  delete from public.club_inventory where organisation_id = p_organisation_id;

  delete from public.club_refunds where organisation_id = p_organisation_id;
  delete from public.club_payments where organisation_id = p_organisation_id;
  delete from public.club_order_discounts where organisation_id = p_organisation_id;
  delete from public.club_orders where organisation_id = p_organisation_id;
  get diagnostics v_orders = row_count;
  delete from public.club_cash_declarations where organisation_id = p_organisation_id;
  delete from public.club_balance_entries where organisation_id = p_organisation_id;

  return jsonb_build_object('ordersCleared', v_orders, 'stockMovementsCleared', v_movements, 'supplierDemandCleared', v_supplier_demand);
end;
$$;

revoke all on function public.club_prepare_go_live(uuid) from public, anon;
grant execute on function public.club_prepare_go_live(uuid) to authenticated;
