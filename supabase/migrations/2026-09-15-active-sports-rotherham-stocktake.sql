-- Exact Rotherham physical stocktake for Active Sports supplements.
-- The ledger is reconciled to the count (delta), never incremented blindly.
do $$
declare
  v_org uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid;
  v_location uuid;
  v_row record;
  v_professional_id uuid;
  v_isolate_id uuid;
begin
  select id into v_location from public.club_locations
  where organisation_id=v_org and active and lower(btrim(name))='rotherham'
  order by id limit 1;
  if v_location is null then raise exception 'No active Rotherham location found; stocktake aborted' using errcode='P0002'; end if;

  -- Correct only the confirmed variant's parent; never rename the Isolate family.
  select pp.id into v_professional_id
  from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
  where pp.organisation_id=v_org and s.name='Active Sports' and pp.brand='Scitec Nutrition'
    and pp.name='100% Whey Protein Professional' limit 1;
  select pp.id into v_isolate_id
  from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
  where pp.organisation_id=v_org and s.name='Active Sports' and pp.brand='Scitec Nutrition'
    and pp.name='100% Whey Isolate' limit 1;
  if v_professional_id is not null and v_isolate_id is not null then
    update public.club_supplier_products sp set parent_product_id=v_professional_id, updated_at=now()
    where sp.organisation_id=v_org and sp.parent_product_id=v_isolate_id and sp.active and not sp.discontinued
      and lower(btrim(coalesce(sp.size,'')))='1816g' and lower(btrim(coalesce(sp.variant,'')))='strawberry white chocolate';
  elsif v_professional_id is null then
    raise notice 'Scitec Professional parent missing; no Isolate variants were moved';
  end if;

  for v_row in
    with counts(brand,product,size,flavour,qty) as (values
      ('Applied Nutrition','Creatine Gummies','80 gummies','Millions Blackcurrant',1),
      ('Trained By JP','Cream of Rice','2kg','Chocolate Hazelnut Spread',1),
      ('Conteh Sports','Vitamin D3 + K2','120 caps','',1),
      ('DNA Sports','Shilajit','60 caps','',2),
      ('Black Mamba','Lions Mane','60 caps','',2),
      ('Apocalypse Nutrition','Zinc, Magnesium and Vitamin B6','90 caps','',1),
      ('BioTech USA','Ashwa+','30 caps','',1),
      ('Black Mamba','Glutamine','250g','',1),
      ('CNP Professional','Loaded H2O','300g','Blue Bears',1),
      ('Muscle King Nutrition','Creatine Monohydrate Powder','250g','Unflavoured',1),
      ('CNP Professional','Loaded EAA','300g','Cherry Cola',1),
      ('Scitec Nutrition','100% Whey Protein Professional','1816g','Strawberry White Chocolate',1),
      ('Trained By JP','Performance Protein','1kg','Cookies & Cream',1),
      ('Trained By JP','Performance Protein','1kg','Chocolate Mint',1),
      ('Reflex Nutrition','Instant Mass Heavyweight','2kg','Salted Caramel',1)
    ), matches as (
      select c.*, cp.id product_id, count(cp.id) over (partition by c.brand,c.product,c.size,c.flavour) match_count
      from counts c
      left join public.club_supplier_parent_products pp on pp.organisation_id=v_org and lower(btrim(pp.brand))=lower(c.brand) and lower(btrim(pp.name))=lower(c.product)
      left join public.club_suppliers s on s.id=pp.supplier_id and s.name='Active Sports'
      left join public.club_supplier_products sp on sp.organisation_id=v_org and sp.parent_product_id=pp.id and lower(btrim(coalesce(sp.size,'')))=lower(c.size) and lower(btrim(coalesce(sp.variant,'')))=lower(c.flavour) and sp.active and not sp.discontinued
      left join public.club_commerce_products cp on cp.organisation_id=v_org and cp.id=sp.club_product_id and cp.active
    ), resolved as (
      select brand,product,size,flavour,qty,product_id from matches where product_id is not null and match_count=1
    ), stock_rows as (
      select resolved_row.*, coalesce(sum(sm.quantity_delta),0)::integer current_qty
      from resolved resolved_row left join public.club_stock_movements sm on sm.organisation_id=v_org and sm.location_id=v_location and sm.product_id=resolved_row.product_id
      group by resolved_row.brand,resolved_row.product,resolved_row.size,resolved_row.flavour,resolved_row.qty,resolved_row.product_id
    ) select * from stock_rows
  loop
    if v_row.qty-v_row.current_qty <> 0 and not exists (
      select 1
      from public.club_stock_movements existing_move
      where existing_move.organisation_id=v_org
        and existing_move.location_id=v_location
        and existing_move.product_id=v_row.product_id
        and existing_move.movement_type='stocktake_adjustment'
        and existing_move.reason='Rotherham physical stocktake 2026-09-13'
        and existing_move.idempotency_key='active-sports-rotherham-stocktake-2026-09-13:'||v_row.product_id
    ) then
      insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,idempotency_key)
      values(v_org,v_location,v_row.product_id,'stocktake_adjustment',v_row.qty-v_row.current_qty,'Rotherham physical stocktake 2026-09-13','active-sports-rotherham-stocktake-2026-09-13:'||v_row.product_id);
    end if;
  end loop;

  for v_row in
    with counts(brand,product,size,flavour) as (values
      ('Applied Nutrition','Creatine Gummies','80 gummies','Millions Blackcurrant'),('Trained By JP','Cream of Rice','2kg','Chocolate Hazelnut Spread'),('Conteh Sports','Vitamin D3 + K2','120 caps',''),('DNA Sports','Shilajit','60 caps',''),('Black Mamba','Lions Mane','60 caps',''),('Apocalypse Nutrition','Zinc, Magnesium and Vitamin B6','90 caps',''),('BioTech USA','Ashwa+','30 caps',''),('Black Mamba','Glutamine','250g',''),('CNP Professional','Loaded H2O','300g','Blue Bears'),('Muscle King Nutrition','Creatine Monohydrate Powder','250g','Unflavoured'),('CNP Professional','Loaded EAA','300g','Cherry Cola'),('Scitec Nutrition','100% Whey Protein Professional','1816g','Strawberry White Chocolate'),('Trained By JP','Performance Protein','1kg','Cookies & Cream'),('Trained By JP','Performance Protein','1kg','Chocolate Mint'),('Reflex Nutrition','Instant Mass Heavyweight','2kg','Salted Caramel'))
    select candidate_rows.*
    from (
      select c.*,
        (select count(*)::integer
         from public.club_supplier_parent_products pp
         join public.club_suppliers s on s.id=pp.supplier_id
         join public.club_supplier_products sp on sp.parent_product_id=pp.id
         join public.club_commerce_products cp on cp.id=sp.club_product_id
         where pp.organisation_id=v_org and s.name='Active Sports'
           and lower(btrim(pp.brand))=lower(c.brand)
           and lower(btrim(pp.name))=lower(c.product)
           and lower(btrim(coalesce(sp.size,'')))=lower(c.size)
           and lower(btrim(coalesce(sp.variant,'')))=lower(c.flavour)
           and cp.active and sp.active and not sp.discontinued) as match_count
      from counts c
    ) candidate_rows
    where candidate_rows.match_count <> 1
  loop raise notice 'Unresolved Active Sports stocktake line: % / % / % / % (match count %)',v_row.brand,v_row.product,v_row.size,v_row.flavour,v_row.match_count; end loop;
end $$;

-- Verification (read-only):
-- select cp.brand,cp.name,sp.size,sp.variant,coalesce(sum(sm.quantity_delta),0) quantity
-- from public.club_commerce_products cp join public.club_supplier_products sp on sp.club_product_id=cp.id
-- join public.club_supplier_parent_products pp on pp.id=sp.parent_product_id join public.club_suppliers s on s.id=pp.supplier_id
-- left join public.club_stock_movements sm on sm.product_id=cp.id and sm.location_id=(select id from public.club_locations where organisation_id=cp.organisation_id and active and lower(name)='rotherham' limit 1)
-- where cp.organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb' and s.name='Active Sports' group by cp.brand,cp.name,sp.size,sp.variant;
