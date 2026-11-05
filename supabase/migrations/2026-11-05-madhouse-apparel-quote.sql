-- Read-only quote for the public Madhouse storefront. The checkout preparation
-- RPC remains authoritative and repeats every validation before order creation.
create or replace function public.club_quote_madhouse_apparel_checkout(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  org constant uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  line jsonb; pub public.club_website_shop_publications%rowtype;
  prod public.club_commerce_products%rowtype;
  subtotal integer := 0; discount integer := 0; total integer; qty integer; price integer;
  hoodie_count integer := 0; tee_count integer := 0; pair_count integer := 0;
  eligible_left integer; tee_discount integer; discounted_qty integer; idx integer;
  line_data jsonb := '[]'::jsonb; hoodie_group jsonb; tee_group jsonb; promo record;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'Basket is invalid' using errcode='22023';
  end if;

  for line in select value from jsonb_array_elements(p_items) loop
    qty := case when (line->>'quantity') ~ '^[0-9]+$' then (line->>'quantity')::integer else 0 end;
    if qty < 1 or qty > 20 or line->>'size' not in ('S','M','L','XL','2XL','3XL','4XL','5XL')
      or nullif(line->>'productId','') is null then
      raise exception 'Basket quantity or size is invalid' using errcode='22023';
    end if;
    select w.* into pub
    from public.club_website_shop_publications w
    join public.club_product_families f on f.id=w.family_id and f.organisation_id=w.organisation_id and f.active and f.archived_at is null
    left join public.club_website_shop_family_settings fs on fs.organisation_id=w.organisation_id and fs.family_id=w.family_id
    where w.organisation_id=org and w.public_slug=line->>'productId'
      and w.published and w.available and w.mapping_verified and coalesce(fs.visible,true)
      and w.website_available_sizes @> array[line->>'size']::text[];
    if not found then raise exception 'A garment or selected size is no longer available' using errcode='22023'; end if;

    select p.* into prod from public.club_commerce_products p
    where p.organisation_id=org and p.family_id=pub.family_id
      and p.variant_options->>'colour'=pub.variant_colour
      and p.variant_options->>'size'=line->>'size' and p.active;
    if not found then raise exception 'A garment or selected size is no longer available' using errcode='22023'; end if;

    if pub.website_price_minor is not null then price:=pub.website_price_minor;
    else
      select case when count(*)=8 and count(distinct sell_price_minor)=1 and min(sell_price_minor)>0
        then min(sell_price_minor) end into price
      from public.club_commerce_products where organisation_id=org and family_id=pub.family_id
        and variant_options->>'colour'=pub.variant_colour and active;
    end if;
    if price is null or price<1 then raise exception 'Website price is not configured' using errcode='22023'; end if;
    subtotal:=subtotal+price*qty;
    if pub.family_id='912a3ec3-c8cc-48c0-9d20-9223584d0714' then hoodie_count:=hoodie_count+qty; end if;
    if pub.family_id='fccc70d5-2db2-45ab-be4f-3cd728c28aa8' then tee_count:=tee_count+qty; end if;
    line_data:=line_data||jsonb_build_array(jsonb_build_object(
      'slug',pub.public_slug,'name',pub.display_name,'colour',pub.public_colour,
      'size',line->>'size','quantity',qty,'unit_price_minor',price,
      'family_id',pub.family_id,'product_id',prod.id,'discount_quantity',0));
  end loop;

  if hoodie_count>0 and tee_count>0 then
    select p.eligibility into promo from public.club_promotions p
    where p.organisation_id=org and p.status='active' and now()>=p.starts_at
      and (p.ends_at is null or now()<p.ends_at)
      and cardinality(coalesce(p.location_ids,'{}'::uuid[]))=0
      and p.eligibility ? 'bundle_groups' and p.eligibility ? 'bundle_price_minor'
      and p.name ilike '%hoodie%t-shirt%'
    order by coalesce((p.eligibility->>'priority')::integer,0) desc limit 1;
    if not found then raise exception 'The current R12 hoodie and T-shirt offer cannot be verified' using errcode='22023'; end if;
    select value into hoodie_group from jsonb_array_elements(promo.eligibility->'bundle_groups') where value->>'group_id'='hoodie' limit 1;
    select value into tee_group from jsonb_array_elements(promo.eligibility->'bundle_groups') where value->>'group_id'='tshirt' limit 1;
    if hoodie_group is null or tee_group is null then raise exception 'The R12 apparel offer is not configured for these products' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(line_data) x where x->>'family_id'='912a3ec3-c8cc-48c0-9d20-9223584d0714' and not ((hoodie_group->'product_ids') ? (x->>'product_id')))
      or exists(select 1 from jsonb_array_elements(line_data) x where x->>'family_id'='fccc70d5-2db2-45ab-be4f-3cd728c28aa8' and not ((tee_group->'product_ids') ? (x->>'product_id'))) then
      raise exception 'The R12 apparel offer does not match the published products' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(line_data) h cross join jsonb_array_elements(line_data) t
      where h->>'family_id'='912a3ec3-c8cc-48c0-9d20-9223584d0714'
        and (tee_group->'product_ids') ? (t->>'product_id')
        and t->>'family_id'='fccc70d5-2db2-45ab-be4f-3cd728c28aa8'
        and (hoodie_group->'product_ids') ? (h->>'product_id')
        and (h->>'unit_price_minor')::integer+(t->>'unit_price_minor')::integer
          - floor((t->>'unit_price_minor')::numeric/2)::integer
          <> (promo.eligibility->>'bundle_price_minor')::integer) then
      raise exception 'The R12 offer does not match the current website prices' using errcode='22023';
    end if;
    pair_count:=least(hoodie_count,tee_count);
    if not coalesce((promo.eligibility->>'repeatable')::boolean,true) then pair_count:=least(pair_count,1); end if;
    eligible_left:=pair_count;
    for idx in 0..jsonb_array_length(line_data)-1 loop
      line:=line_data->idx;
      if line->>'family_id'='fccc70d5-2db2-45ab-be4f-3cd728c28aa8'
        and ((tee_group->'product_ids') ? (line->>'product_id')) and eligible_left>0 then
        discounted_qty:=least(eligible_left,(line->>'quantity')::integer);
        tee_discount:=floor((line->>'unit_price_minor')::numeric/2)::integer;
        discount:=discount+discounted_qty*tee_discount;
        eligible_left:=eligible_left-discounted_qty;
        line_data:=jsonb_set(line_data,array[idx::text,'discount_quantity'],to_jsonb(discounted_qty));
      end if;
    end loop;
  end if;
  total:=subtotal-discount+395;
  return jsonb_build_object('currency','GBP','subtotal_minor',subtotal,'discount_minor',discount,
    'delivery_minor',395,'total_minor',total,'lines',line_data,
    'promotion_applied',discount>0);
end;
$$;
revoke all on function public.club_quote_madhouse_apparel_checkout(jsonb) from public, anon, authenticated;
grant execute on function public.club_quote_madhouse_apparel_checkout(jsonb) to service_role;
