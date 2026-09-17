-- Apply the three reviewed Active Sports family images.  This is deliberately
-- scoped by organisation, supplier, brand and parent identity so it cannot
-- affect similarly named products from another supplier.
do $$
declare
  v_org uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb';
  v_supplier_ids uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[])
    into v_supplier_ids
    from public.club_suppliers
   where organisation_id = v_org
     and lower(name) in ('active sports', 'active sports nutrition');

  update public.club_supplier_parent_products
     set parent_image_url = case
       when lower(brand) = 'black mamba' and lower(name) = 'glutamine'
         then 'https://www.activesportstrade.co.uk/images/XL/black-mamba-glutamine.jpg'
       when lower(brand) = 'trained by jp' and lower(name) = 'performance protein'
         then 'https://www.activesportstrade.co.uk/images/XL/jp-performance-protein-1kg.jpg'
       when lower(brand) = 'conteh sports' and lower(name) = 'vitamin d3 + k2'
         then 'https://www.activesportstrade.co.uk/images/XL/conteh-d3-k2.jpg'
     end,
     updated_at = now()
   where organisation_id = v_org
     and supplier_id = any(v_supplier_ids)
     and (
       (lower(brand) = 'black mamba' and lower(name) = 'glutamine')
       or (lower(brand) = 'trained by jp' and lower(name) = 'performance protein')
       or (lower(brand) = 'conteh sports' and lower(name) = 'vitamin d3 + k2')
     );

  -- Refresh the family and linked variant commerce media without touching
  -- prices, stock, availability or product identity.
  update public.club_product_families f
     set media = jsonb_build_object('url', case
       when lower(f.brand) = 'black mamba' and lower(f.name) = 'glutamine'
         then 'https://www.activesportstrade.co.uk/images/XL/black-mamba-glutamine.jpg'
       when lower(f.brand) = 'trained by jp' and lower(f.name) = 'performance protein'
         then 'https://www.activesportstrade.co.uk/images/XL/jp-performance-protein-1kg.jpg'
       when lower(f.brand) = 'conteh sports' and lower(f.name) = 'vitamin d3 + k2'
         then 'https://www.activesportstrade.co.uk/images/XL/conteh-d3-k2.jpg'
     end),
         updated_at = now()
   where f.organisation_id = v_org
     and exists (
       select 1
         from public.club_supplier_parent_products pp
        where pp.organisation_id = v_org
          and pp.supplier_id = any(v_supplier_ids)
          and pp.id in (
            select distinct sp.parent_product_id
              from public.club_supplier_products sp
             where sp.organisation_id = v_org
               and sp.club_product_id is not null
          )
          and lower(pp.brand) = lower(f.brand)
          and lower(pp.name) = lower(f.name)
     );

  update public.club_commerce_products cp
     set media = jsonb_build_object('url', case
       when lower(cp.brand) = 'black mamba' and lower(cp.name) = 'glutamine'
         then 'https://www.activesportstrade.co.uk/images/XL/black-mamba-glutamine.jpg'
       when lower(cp.brand) = 'trained by jp' and lower(cp.name) = 'performance protein'
         then 'https://www.activesportstrade.co.uk/images/XL/jp-performance-protein-1kg.jpg'
       when lower(cp.brand) = 'conteh sports' and lower(cp.name) = 'vitamin d3 + k2'
         then 'https://www.activesportstrade.co.uk/images/XL/conteh-d3-k2.jpg'
     end),
         updated_at = now()
   where cp.organisation_id = v_org
     and cp.supplier_reference like 'supplier_product:%'
     and exists (
       select 1
         from public.club_supplier_products sp
         join public.club_supplier_parent_products pp on pp.id = sp.parent_product_id
        where sp.organisation_id = v_org
          and pp.organisation_id = v_org
          and pp.supplier_id = any(v_supplier_ids)
          and ('supplier_product:' || sp.id::text) = cp.supplier_reference
          and lower(pp.brand) = lower(cp.brand)
          and lower(pp.name) = lower(cp.name)
     )
     and (
       (lower(cp.brand) = 'black mamba' and lower(cp.name) = 'glutamine')
       or (lower(cp.brand) = 'trained by jp' and lower(cp.name) = 'performance protein')
       or (lower(cp.brand) = 'conteh sports' and lower(cp.name) = 'vitamin d3 + k2')
     );
end;
$$;
