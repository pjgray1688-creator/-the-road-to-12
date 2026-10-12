-- Keep supplier commercial history limited to imported rows, but propagate the
-- authoritative generated/manual supplier retail price for linked supplier
-- sales units even when their canonical cost_price_minor is populated.
-- The canonical pricing guard remains the only gate for this price update.
create or replace function public.club_supplier_commercial_audit()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.import_identity is not null then
    if tg_op='UPDATE'
      and old.trade_cost_ex_vat_minor is null
      and old.wholesale_cost_minor is not null then
      insert into public.club_supplier_variant_costs(
        organisation_id,supplier_id,supplier_product_id,cost_minor,observed_at,source_reference,created_by
      ) values (
        old.organisation_id,old.supplier_id,old.id,old.wholesale_cost_minor,old.updated_at,
        'Previous recorded supplier cost; VAT basis not established',auth.uid()
      );
    end if;

    if tg_op='INSERT'
      or old.trade_cost_ex_vat_minor is distinct from new.trade_cost_ex_vat_minor
      or old.supplied_vat_rate is distinct from new.supplied_vat_rate then
      insert into public.club_supplier_variant_costs(
        organisation_id,supplier_id,supplier_product_id,cost_minor,trade_cost_ex_vat_minor,
        supplied_vat_rate,observed_at,source_reference,created_by
      ) values (
        new.organisation_id,new.supplier_id,new.id,new.wholesale_cost_minor,
        new.trade_cost_ex_vat_minor,new.supplied_vat_rate,
        coalesce(new.availability_checked_at,now()),new.cost_source,auth.uid()
      );
    end if;
  end if;

  -- This is the single supplier-authoritative propagation path for both
  -- generated prices and staff-approved prices. Exact linkage and organisation
  -- checks prevent touching local products or another supplier's sales unit.
  if new.club_product_id is not null and new.retail_price_minor is not null then
    update public.club_commerce_products as cp
    set sell_price_minor=new.retail_price_minor,
        active=new.sellable,
        updated_at=now()
    where cp.id=new.club_product_id
      and cp.organisation_id=new.organisation_id
      and cp.supplier_reference='supplier_product:'||new.id::text
      and not cp.stock_tracked
      and cp.service_id is null
      and (
        cp.sell_price_minor is distinct from new.retail_price_minor
        or cp.active is distinct from new.sellable
      );
  end if;

  return new;
end;
$$;

revoke all on function public.club_supplier_commercial_audit() from public,anon,authenticated;
