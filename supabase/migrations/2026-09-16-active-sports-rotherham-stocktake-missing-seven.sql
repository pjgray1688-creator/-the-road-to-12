-- Reconcile the seven Active Sports lines that were not resolved by the
-- original Rotherham stocktake.  This migration is intentionally scoped to
-- these identities and never changes the already-correct eight lines.
do $$
declare
  v_org uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid;
  v_location uuid;
  v_row record;
begin
  select id into v_location
  from public.club_locations
  where organisation_id=v_org and active and lower(btrim(name))='rotherham'
  order by id limit 1;
  if v_location is null then
    raise exception 'No active Rotherham location found; seven-line stocktake aborted' using errcode='P0002';
  end if;

  -- If the earlier safe correction left the confirmed Scitec variant under
  -- Isolate, move only that exact variant to the existing Professional parent.
  update public.club_supplier_products sp
  set parent_product_id=professional_parent.id, updated_at=now()
  from public.club_supplier_parent_products isolate_parent
  join public.club_supplier_parent_products professional_parent
    on professional_parent.organisation_id=isolate_parent.organisation_id
   and professional_parent.supplier_id=isolate_parent.supplier_id
   and lower(btrim(professional_parent.brand))='scitec nutrition'
   and lower(btrim(professional_parent.name))='100% whey protein professional'
  join public.club_suppliers supplier on supplier.id=isolate_parent.supplier_id
  where sp.organisation_id=v_org
    and isolate_parent.organisation_id=v_org
    and supplier.name='Active Sports'
    and lower(btrim(isolate_parent.brand))='scitec nutrition'
    and lower(btrim(isolate_parent.name))='100% whey isolate'
    and sp.parent_product_id=isolate_parent.id
    and sp.active and not sp.discontinued
    and regexp_replace(lower(coalesce(sp.size,'')),'\\s+','','g')='1816g'
    and regexp_replace(lower(coalesce(sp.variant,'')),'[^a-z0-9]+','','g')='strawberrywhitechocolate';

  -- Each target is normalized once.  Blank, Default and Unflavoured all
  -- represent the same no-flavour identity for these physical products.
  for v_row in
    with targets(brand,product,size,flavour,target_qty) as (values
      ('Conteh Sports','Vitamin D3 + K2','120 caps','',1),
      ('DNA Sports','Shilajit','60 caps','',2),
      ('Black Mamba','Lions Mane','60 caps','',2),
      ('Apocalypse Nutrition','Zinc, Magnesium and Vitamin B6','90 caps','',1),
      ('BioTech USA','Ashwa+','30 caps','',1),
      ('Black Mamba','Glutamine','250g','',1),
      ('Scitec Nutrition','100% Whey Protein Professional','1816g','Strawberry White Chocolate',1)
    ), candidate_rows as (
      select t.*, cp.id product_id
      from targets t
      join public.club_supplier_parent_products pp
        on pp.organisation_id=v_org
       and regexp_replace(lower(coalesce(pp.brand,'')),'[^a-z0-9]+','','g')=regexp_replace(lower(t.brand),'[^a-z0-9]+','','g')
       and regexp_replace(lower(coalesce(pp.name,'')),'[^a-z0-9]+','','g')=regexp_replace(lower(t.product),'[^a-z0-9]+','','g')
      join public.club_suppliers supplier on supplier.id=pp.supplier_id and supplier.name='Active Sports'
      join public.club_supplier_products sp
        on sp.organisation_id=v_org and sp.parent_product_id=pp.id and sp.active and not sp.discontinued
       and regexp_replace(lower(coalesce(sp.size,'')),'\\s+','','g')=regexp_replace(lower(t.size),'\\s+','','g')
       and (
         (regexp_replace(lower(t.flavour),'[^a-z0-9]+','','g')=''
          and regexp_replace(lower(coalesce(sp.variant,'')),'[^a-z0-9]+','','g') in ('','default','noflavour','unflavoured','unflavored','none'))
         or (regexp_replace(lower(t.flavour),'[^a-z0-9]+','','g')<>''
          and regexp_replace(lower(coalesce(sp.variant,'')),'[^a-z0-9]+','','g')=regexp_replace(lower(t.flavour),'[^a-z0-9]+','','g'))
       )
      join public.club_commerce_products cp on cp.organisation_id=v_org and cp.id=sp.club_product_id and cp.active
    ), candidate_summary as (
      select t.brand,t.product,t.size,t.flavour,t.target_qty,
             count(distinct c.product_id)::integer match_count,
             array_agg(distinct c.product_id) filter (where c.product_id is not null) product_ids
      from targets t left join candidate_rows c
        on c.brand=t.brand and c.product=t.product and c.size=t.size and c.flavour=t.flavour
      group by t.brand,t.product,t.size,t.flavour,t.target_qty
    ), stock_rows as (
      select cs.*, coalesce(sum(sm.quantity_delta),0)::integer current_qty
      from candidate_summary cs
      left join public.club_stock_movements sm
        on cs.match_count=1 and sm.organisation_id=v_org and sm.location_id=v_location
       and sm.product_id=cs.product_ids[1]
      group by cs.brand,cs.product,cs.size,cs.flavour,cs.target_qty,cs.match_count,cs.product_ids
    )
    select * from stock_rows
  loop
    raise notice 'Rotherham stocktake evidence: % / % / % / %; matches=% current=% target=% delta=%',
      v_row.brand,v_row.product,v_row.size,v_row.flavour,v_row.match_count,v_row.current_qty,v_row.target_qty,v_row.target_qty-v_row.current_qty;
    if v_row.match_count=1 and v_row.target_qty-v_row.current_qty<>0 and not exists (
      select 1 from public.club_stock_movements existing_move
      where existing_move.organisation_id=v_org and existing_move.location_id=v_location
        and existing_move.product_id=v_row.product_ids[1]
        and existing_move.movement_type='stocktake_adjustment'
        and existing_move.reason='Rotherham physical stocktake 2026-09-13'
        and existing_move.idempotency_key='active-sports-rotherham-stocktake-2026-09-13-missing-seven:'||v_row.product_ids[1]
    ) then
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,idempotency_key)
      values(v_org,v_location,v_row.product_ids[1],'stocktake_adjustment',v_row.target_qty-v_row.current_qty,
        'Rotherham physical stocktake 2026-09-13','active-sports-rotherham-stocktake-2026-09-13-missing-seven:'||v_row.product_ids[1]);
    end if;
  end loop;
end $$;
