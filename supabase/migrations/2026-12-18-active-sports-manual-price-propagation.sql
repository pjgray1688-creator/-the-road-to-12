-- Propagate staff-approved supplier prices from their authoritative offer row
-- to the linked canonical sales unit through the existing guarded update path.
create or replace function public.club_set_supplier_variant_retail_price(
  p_organisation_id uuid,
  p_supplier_product_id uuid,
  p_retail_price_minor integer,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  o public.club_supplier_products%rowtype;
  v_unchanged boolean:=false;
begin
  if auth.uid() is null
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')
    or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then
    raise exception 'Pricing access required' using errcode='42501';
  end if;
  if p_retail_price_minor is null
    or p_retail_price_minor not between 1 and 100000000
    or p_active is distinct from true then
    raise exception 'Enter a positive GBP selling price' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into o
  from public.club_supplier_products
  where id=p_supplier_product_id and organisation_id=p_organisation_id
  for update;
  if not found then
    raise exception 'Supplier variant not found' using errcode='P0002';
  end if;

  if o.manual_price and o.retail_price_minor=p_retail_price_minor then
    -- An idempotent retry must still repair a stale linked canonical price.
    v_unchanged:=true;
  else
    update public.club_supplier_variant_prices
    set active=false,effective_to=now()
    where organisation_id=p_organisation_id and supplier_product_id=o.id and active;

    insert into public.club_supplier_variant_prices(
      organisation_id,supplier_product_id,retail_price_minor,created_by,effective_from
    ) values(p_organisation_id,o.id,p_retail_price_minor,auth.uid(),clock_timestamp());

    update public.club_supplier_products
    set retail_price_minor=p_retail_price_minor,manual_price=true,updated_at=now()
    where id=o.id and organisation_id=p_organisation_id;
  end if;

  if o.club_product_id is not null then
    if not exists(
      select 1 from public.club_commerce_products
      where id=o.club_product_id and organisation_id=p_organisation_id
        and not stock_tracked and cost_price_minor is null
    ) then
      raise exception 'Linked supplier sales unit is not eligible for supplier pricing' using errcode='22023';
    end if;

    -- The canonical guard remains enabled. It accepts this update only because
    -- the supplier row above is already authoritative for this same price.
    update public.club_commerce_products
    set sell_price_minor=p_retail_price_minor,updated_at=now()
    where id=o.club_product_id and organisation_id=p_organisation_id
      and not stock_tracked and cost_price_minor is null
      and sell_price_minor is distinct from p_retail_price_minor;
  end if;

  if v_unchanged then
    return jsonb_build_object('unchanged',true);
  end if;
  return jsonb_build_object('retailPriceMinor',p_retail_price_minor,'manualPrice',true);
end;
$$;

revoke all on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) from public,anon;
grant execute on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) to authenticated;
