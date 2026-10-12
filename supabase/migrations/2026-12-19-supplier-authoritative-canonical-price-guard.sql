-- Allow canonical supplier prices to follow only the exact price already
-- recorded on their organisation-scoped supplier offer. Supplier cost remains
-- present on the canonical row and is not itself a reason to reject that sync.
create or replace function public.club_supplier_canonical_price_changed()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  offer public.club_supplier_products%rowtype;
begin
  select * into offer
  from public.club_supplier_products
  where organisation_id=new.organisation_id
    and club_product_id=new.id
    and new.supplier_reference='supplier_product:'||club_supplier_products.id::text
  for share;
  if not found then
    if new.supplier_reference like 'supplier_product:%'
      or exists(
        select 1 from public.club_supplier_products
        where organisation_id=new.organisation_id and club_product_id=new.id
      ) then
      raise exception 'Use the supplier pricing controls for this sales unit' using errcode='22023';
    end if;
    return new;
  end if;

  if new.stock_tracked or new.service_id is not null then
    raise exception 'Use the supplier pricing controls for this sales unit' using errcode='22023';
  end if;

  -- The supplier-price propagation exception does not authorize changing the
  -- canonical cost record, either alone or alongside a retail-price write.
  if new.cost_price_minor is distinct from old.cost_price_minor then
    raise exception 'Use the supplier pricing controls for this sales unit' using errcode='22023';
  end if;

  -- A supplier-authoritative update (manual or generated) may propagate even
  -- when cost_price_minor is populated, but only after the supplier row already
  -- contains this exact price for this exact canonical product.
  if offer.retail_price_minor is not null
    and offer.retail_price_minor=new.sell_price_minor then
    return new;
  end if;

  -- Preserve the legacy staff-edit route only for costless supplier sales units.
  -- Supplier-linked products carrying supplier cost cannot use direct writes.
  if new.cost_price_minor is not null then
    raise exception 'Use the supplier pricing controls for this sales unit' using errcode='22023';
  end if;

  if offer.retail_price_minor is distinct from new.sell_price_minor then
    perform public.club_set_supplier_variant_retail_price(new.organisation_id,offer.id,new.sell_price_minor,true);
  end if;
  return new;
end;
$$;

revoke all on function public.club_supplier_canonical_price_changed() from public,anon,authenticated;
