-- Real PostgreSQL exercise of the import RPC and its following commerce link.
-- This fixture is transactional and must run only in disposable CI databases.
begin;
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000001','catalogue-manager@example.test');
insert into public.club_organisations(id,name,slug) values ('10000000-0000-4000-8000-000000000002','Active Sports RPC fixture','active-sports-rpc-fixture');
insert into public.club_locations(id,organisation_id,name) values ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','RPC Test Location');
insert into public.club_members(organisation_id,user_id,role) values ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','owner');
-- Privileged fixture setup only: the stock product is a separate local POS item,
-- not the supplier-orderable canonical product created by the importer/linker.
insert into public.club_commerce_products(id,organisation_id,sku,name,brand,category,active,stock_tracked,sell_price_minor,currency,supplier_reference)
values ('10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','LOCAL-WHEY-001','Local Whey Case Shelf Stock','Test Brand','Supplements',true,true,7777,'GBP',null);
select set_config('r12.active_sports_fixture_local_product_id',
 (select id::text from public.club_commerce_products where organisation_id='10000000-0000-4000-8000-000000000002' and sku='LOCAL-WHEY-001'),true);
-- Model a previous partial catalogue import: an existing supplier/parent and
-- legacy exact variant with no import_identity must be adopted, not duplicated.
insert into public.club_suppliers(id,organisation_id,name,slug)
values ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','Active Sports','active-sports');
insert into public.club_supplier_parent_products(id,organisation_id,supplier_id,parent_key,brand,name)
values ('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','test|whey protein','Test Brand','Whey Protein');
insert into public.club_supplier_products(id,organisation_id,supplier_id,parent_product_id,brand,name,variant,size,pack_quantity,member_orderable_unit)
values ('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','Test Brand','Whey Protein','Chocolate','12 x 60g',12,'case');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

set local role authenticated;
select public.club_import_supplier_catalogue_v2(
 '10000000-0000-4000-8000-000000000002','Active Sports','active-sports-ci.csv',
 '[
  {"name":"Energy Can","parentKey":"test|energy can","brand":"Test Brand","category":"Drinks","subcategory":"Energy","description":"Single can fixture","size":"500ml","flavour":"Original","supplierSku":"AS-UNIT-001","barcode":"5000000000001","packQuantity":1,"memberOrderableUnit":"each","availabilityStatus":"available","availabilityCheckedAt":"2026-10-10T10:00:00Z","tradeCostExVatMinor":100,"suppliedVatRate":0.2,"sourceUrl":"https://supplier.example.test/energy","parentImageUrl":"https://images.example.test/energy-parent.jpg","variantImageUrl":"https://images.example.test/energy-unit.jpg","notes":"unit fixture","discontinued":false},
  {"name":"Whey Protein","parentKey":"test|whey protein","brand":"Test Brand","category":"Supplements","subcategory":"Protein","description":"Case fixture","size":"12 x 60g","flavour":"Chocolate","supplierSku":"AS-CASE-CHOC","barcode":"5000000000002","packQuantity":12,"memberOrderableUnit":"case","availabilityStatus":"available","availabilityCheckedAt":"2026-10-10T10:00:00Z","tradeCostExVatMinor":2000,"suppliedVatRate":0.2,"sourceUrl":"https://supplier.example.test/whey","parentImageUrl":"https://images.example.test/whey-parent.jpg","variantImageUrl":"https://images.example.test/whey-choc.jpg","notes":"case fixture","discontinued":false},
  {"name":"Whey Protein","parentKey":"test|whey protein","brand":"Test Brand","category":"Supplements","subcategory":"Protein","description":"Case fixture","size":"12 x 60g","flavour":"Vanilla","supplierSku":"AS-CASE-VAN","barcode":"5000000000003","packQuantity":12,"memberOrderableUnit":"case","availabilityStatus":"unavailable","availabilityCheckedAt":"2026-10-10T10:00:00Z","tradeCostExVatMinor":2000,"suppliedVatRate":0.2,"sourceUrl":"https://supplier.example.test/whey","parentImageUrl":"https://images.example.test/whey-parent.jpg","variantImageUrl":"https://images.example.test/whey-vanilla.jpg","notes":"out-of-stock sibling","discontinued":false}
 ]'::jsonb,false
);
select public.club_link_supplier_catalogue_to_commerce('10000000-0000-4000-8000-000000000002','Active Sports');
reset role;

do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; s uuid; p uuid;
begin
 select id into s from public.club_suppliers where organisation_id=o and name='Active Sports';
 if s is null or (select count(*) from public.club_supplier_parent_products where organisation_id=o and supplier_id=s)<>2
   or (select count(*) from public.club_supplier_products where organisation_id=o and supplier_id=s)<>3 then
   raise exception 'Importer failed parent grouping or variant creation';
 end if;
 if not exists(select 1 from public.club_supplier_import_batches where organisation_id=o and file_name='active-sports-ci.csv' and created_count=2 and updated_count=1) then
   raise exception 'Importer did not adopt the pre-existing legacy exact variant';
 end if;
 if (select pack_quantity from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>12
   or (select member_orderable_unit from public.club_supplier_products where organisation_id=o and supplier_sku='AS-UNIT-001')<>'each' then
   raise exception 'Pack quantity or member sellable unit was not persisted';
 end if;
 if (select availability_status from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-VAN')<>'unavailable'
   or (select trade_cost_ex_vat_minor from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>2000 then
   raise exception 'Availability or supplier cost was not persisted';
 end if;
 if (select parent_image_url from public.club_supplier_parent_products where organisation_id=o and supplier_id=s and parent_key='test|whey protein')<>'https://images.example.test/whey-parent.jpg'
   or (select variant_image_url from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>'https://images.example.test/whey-choc.jpg'
   or (select source_url from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>'https://supplier.example.test/whey' then
   raise exception 'Supplier source or imagery fields were lost';
 end if;
 select club_product_id into p from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC';
 if p is null then raise exception 'Commerce linker did not create the canonical product'; end if;
 if not exists(
   select 1 from public.club_supplier_products sp
   join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
   where sp.organisation_id=o and sp.supplier_sku='AS-CASE-CHOC'
     and cp.supplier_reference='supplier_product:'||sp.id::text
     and cp.stock_tracked=false and cp.service_id is null
     and cp.cost_price_minor=2000 and cp.sell_price_minor=3500
 ) then
   raise exception 'Initial supplier sales-unit eligibility mismatch (expected same-org exact link, non-stock, non-service, cost 2000, retail 3500)';
 end if;
 if not exists(
   select 1 from public.club_supplier_products sp
   join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
   where sp.organisation_id=o and sp.supplier_sku='AS-CASE-VAN'
     and sp.retail_price_minor=3500 and sp.manual_price=false
     and cp.sell_price_minor=3500 and cp.cost_price_minor=2000
 ) then
   raise exception 'Initial generated supplier/canonical price expected 3500 with populated cost and manual_price=false';
 end if;
end $$;

-- Establish the approved supplier retail price through the same capability-checked
-- pricing RPC used by the supplier-catalogue action. Supplier-linked products stay
-- supplier-orderable; local shelf stock is a separate POS product and ledger.
select set_config(
 'r12.active_sports_fixture_variant_id',
 (select id::text from public.club_supplier_products
  where organisation_id='10000000-0000-4000-8000-000000000002'
    and supplier_sku='AS-CASE-CHOC'),
 true
);
set local role authenticated;
select public.club_set_supplier_variant_retail_price(
 '10000000-0000-4000-8000-000000000002',
 current_setting('r12.active_sports_fixture_variant_id')::uuid,
 7777,true
);
reset role;

-- The canonical guard stays active: a price that disagrees with the supplier
-- authority is rejected, including a combined cost + arbitrary-price update.
do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; p uuid;
begin
 select club_product_id into strict p from public.club_supplier_products
 where organisation_id=o and supplier_sku='AS-CASE-CHOC';
 begin
   update public.club_commerce_products set sell_price_minor=7778
   where id=p and organisation_id=o;
   raise exception 'Expected arbitrary canonical price update to be rejected';
 exception when others then
   if sqlerrm='Expected arbitrary canonical price update to be rejected' then raise; end if;
   if sqlerrm<>'Use the supplier pricing controls for this sales unit' then raise; end if;
 end;
 begin
   update public.club_commerce_products
   set cost_price_minor=2001,sell_price_minor=8888
   where id=p and organisation_id=o;
   raise exception 'Expected combined cost and arbitrary price update to be rejected';
 exception when others then
   if sqlerrm='Expected combined cost and arbitrary price update to be rejected' then raise; end if;
   if sqlerrm<>'Use the supplier pricing controls for this sales unit' then raise; end if;
 end;
 begin
   update public.club_commerce_products
   set cost_price_minor=2001,sell_price_minor=7777
   where id=p and organisation_id=o;
   raise exception 'Expected supplier-matching price not to authorize a cost edit';
 exception when others then
   if sqlerrm='Expected supplier-matching price not to authorize a cost edit' then raise; end if;
   if sqlerrm<>'Use the supplier pricing controls for this sales unit' then raise; end if;
 end;
 if not exists(select 1 from public.club_commerce_products where id=p and organisation_id=o and sell_price_minor=7777 and cost_price_minor=2000) then
   raise exception 'Rejected direct update changed canonical price or supplier cost';
 end if;
end $$;

set local role authenticated;

-- Record opening local stock as the authenticated R12 owner through the audited RPC.
do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; local_product uuid;
begin
 local_product:=current_setting('r12.active_sports_fixture_local_product_id')::uuid;
 perform public.club_adjust_inventory(
   p_organisation_id => o,
   p_location_id => '10000000-0000-4000-8000-000000000003'::uuid,
   p_product_id => local_product,
   p_movement_type => 'delivery'::text,
   p_quantity_delta => 11,
   p_reason => 'CI opening stock fixture'::text,
   p_idempotency_key => 'active-sports-ci-stock-11'::text
 );
end $$;
reset role;

do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; p uuid; supplier_price integer; is_manual boolean; canonical_price integer;
begin
  select sp.club_product_id,sp.retail_price_minor,sp.manual_price,cp.sell_price_minor
 into p,supplier_price,is_manual,canonical_price
 from public.club_supplier_products sp
 left join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
 where sp.organisation_id=o and sp.supplier_sku='AS-CASE-CHOC';
 if supplier_price is distinct from 7777 then
   raise exception 'Manual supplier retail expected 7777; observed %',supplier_price;
 end if;
 if is_manual is distinct from true then
   raise exception 'Manual supplier flag expected true; observed %',is_manual;
 end if;
 if canonical_price is distinct from 7777 then
   raise exception 'Canonical price after manual pricing expected 7777; observed %',canonical_price;
 end if;
 if (select cost_price_minor from public.club_commerce_products where id=p and organisation_id=o) is distinct from 2000 then
   raise exception 'Canonical supplier cost after manual pricing expected 2000; observed %',(select cost_price_minor from public.club_commerce_products where id=p and organisation_id=o);
 end if;
 if p is null then raise exception 'Linked supplier commerce product disappeared'; end if;
end $$;

create temporary table active_sports_import_preservation_snapshot as
select sp.id as supplier_product_id,sp.club_product_id as canonical_product_id,cp.sell_price_minor as canonical_price_minor,
       cp.stock_tracked as canonical_stock_tracked,cp.cost_price_minor as canonical_cost_price_minor,
       localp.id as local_product_id,localp.stock_tracked as local_stock_tracked,
       coalesce((select sum(sm.quantity_delta) from public.club_stock_movements sm where sm.organisation_id=sp.organisation_id and sm.product_id=localp.id),0) as local_on_hand
from public.club_supplier_products sp
join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
cross join public.club_commerce_products localp
where sp.organisation_id='10000000-0000-4000-8000-000000000002'
  and sp.supplier_sku='AS-CASE-CHOC'
  and localp.organisation_id=sp.organisation_id and localp.sku='LOCAL-WHEY-001';

do $$
begin
 if not exists(select 1 from active_sports_import_preservation_snapshot
   where canonical_stock_tracked=false and local_stock_tracked=true and local_on_hand=11) then
   raise exception 'Fixture did not establish distinct supplier-order and local stock state through supported APIs';
 end if;
end $$;

set local role authenticated;
select public.club_import_supplier_catalogue_v2(
 '10000000-0000-4000-8000-000000000002','Active Sports','active-sports-ci-rerun.csv',
 '[
  {"name":"Energy Can","parentKey":"test|energy can","brand":"Test Brand","category":"Drinks","subcategory":"Energy","description":"Single can fixture","size":"500ml","flavour":"Original","supplierSku":"AS-UNIT-001","barcode":"5000000000001","packQuantity":1,"memberOrderableUnit":"each","availabilityStatus":"available","availabilityCheckedAt":"2026-10-10T11:00:00Z","tradeCostExVatMinor":110,"suppliedVatRate":0.2,"sourceUrl":"https://supplier.example.test/energy","parentImageUrl":"https://images.example.test/energy-parent.jpg","variantImageUrl":"https://images.example.test/energy-unit.jpg","notes":"unit fixture","discontinued":false},
  {"name":"Whey Protein","parentKey":"test|whey protein","brand":"Test Brand","category":"Supplements","subcategory":"Protein","description":"Case fixture","size":"12 x 60g","flavour":"Chocolate","supplierSku":"AS-CASE-CHOC","barcode":"5000000000002","packQuantity":12,"memberOrderableUnit":"case","availabilityStatus":"available","availabilityCheckedAt":"2026-10-10T11:00:00Z","tradeCostExVatMinor":2100,"suppliedVatRate":0.2,"sourceUrl":"https://supplier.example.test/whey","parentImageUrl":"https://images.example.test/whey-parent.jpg","variantImageUrl":"https://images.example.test/whey-choc.jpg","notes":"case fixture","discontinued":false},
  {"name":"Whey Protein","parentKey":"test|whey protein","brand":"Test Brand","category":"Supplements","subcategory":"Protein","description":"Case fixture","size":"12 x 60g","flavour":"Vanilla","supplierSku":"AS-CASE-VAN","barcode":"5000000000003","packQuantity":12,"memberOrderableUnit":"case","availabilityStatus":"unavailable","availabilityCheckedAt":"2026-10-10T11:00:00Z","tradeCostExVatMinor":2100,"suppliedVatRate":0.2,"sourceUrl":"https://supplier.example.test/whey","parentImageUrl":"https://images.example.test/whey-parent.jpg","variantImageUrl":"https://images.example.test/whey-vanilla.jpg","notes":"out-of-stock sibling","discontinued":false}
 ]'::jsonb,false
);
reset role;

-- Repricing is expected to reach the existing canonical row from the supplier
-- commercial trigger as part of import, before the linker runs again.
do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; supplier_price integer; is_manual boolean; canonical_price integer;
begin
 select sp.retail_price_minor,sp.manual_price,cp.sell_price_minor
 into supplier_price,is_manual,canonical_price
 from public.club_supplier_products sp
 join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
 where sp.organisation_id=o and sp.supplier_sku='AS-CASE-VAN';
 if supplier_price is distinct from 3600 then
   raise exception 'Generated supplier retail after repeat import expected 3600; observed %',supplier_price;
 end if;
 if is_manual is distinct from false then
   raise exception 'Generated supplier manual flag after repeat import expected false; observed %',is_manual;
 end if;
 if canonical_price is distinct from 3600 then
   raise exception 'Generated canonical price immediately after repeat import expected 3600; observed %',canonical_price;
 end if;
end $$;

set local role authenticated;
select public.club_link_supplier_catalogue_to_commerce('10000000-0000-4000-8000-000000000002','Active Sports');
reset role;

do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; snapshot record;
  supplier_price integer; is_manual boolean; canonical_price integer;
begin
 if (select count(*) from public.club_supplier_parent_products where organisation_id=o)<>2
   or (select count(*) from public.club_supplier_products where organisation_id=o)<>3 then
   raise exception 'Repeat import duplicated parent or exact variant rows';
 end if;
 if not exists(select 1 from public.club_supplier_import_batches where organisation_id=o and file_name='active-sports-ci-rerun.csv' and created_count=0 and updated_count=3) then
   raise exception 'Repeat import did not update all exact variants';
 end if;
 select * into strict snapshot from active_sports_import_preservation_snapshot;
 select sp.retail_price_minor,sp.manual_price,cp.sell_price_minor
 into supplier_price,is_manual,canonical_price
 from public.club_supplier_products sp
 left join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
 where sp.organisation_id=o and sp.supplier_sku='AS-CASE-CHOC';
 if supplier_price is distinct from 7777 then
   raise exception 'Post-repeat supplier retail expected 7777; observed %',supplier_price;
 end if;
 if is_manual is distinct from true then
   raise exception 'Post-repeat manual supplier flag expected true; observed %',is_manual;
 end if;
 if canonical_price is distinct from 7777 then
   raise exception 'Post-repeat canonical price expected 7777; observed %',canonical_price;
 end if;
 if canonical_price is distinct from snapshot.canonical_price_minor then
   raise exception 'Post-repeat canonical price % differs from post-manual snapshot %',canonical_price,snapshot.canonical_price_minor;
 end if;
 if snapshot.canonical_cost_price_minor is distinct from 2000
   or (select cost_price_minor from public.club_commerce_products where id=snapshot.canonical_product_id and organisation_id=o) is distinct from snapshot.canonical_cost_price_minor then
   raise exception 'Repeat import/link changed canonical supplier cost';
 end if;
 if snapshot.canonical_product_id=snapshot.local_product_id then raise exception 'Supplier-order product was conflated with local stock product'; end if;
 if snapshot.canonical_stock_tracked then raise exception 'Supplier-order product was marked as locally stocked'; end if;
 if not snapshot.local_stock_tracked
   or (select coalesce(sum(quantity_delta),0) from public.club_stock_movements where organisation_id=o and product_id=snapshot.local_product_id) is distinct from snapshot.local_on_hand then
   raise exception 'Import/link changed the independently managed Club physical stock';
 end if;
 if (select availability_status from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-VAN')<>'unavailable'
   or not exists(select 1 from public.club_stock_movements where organisation_id=o and product_id=snapshot.local_product_id and idempotency_key='active-sports-ci-stock-11') then
   raise exception 'Supplier availability was conflated with local stock movements';
 end if;
 select sp.retail_price_minor,sp.manual_price,cp.sell_price_minor
 into supplier_price,is_manual,canonical_price
 from public.club_supplier_products sp
 left join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
 where sp.organisation_id=o and sp.supplier_sku='AS-CASE-VAN';
 if supplier_price is distinct from 3600 then
   raise exception 'Non-manual supplier retail expected 3600; observed %',supplier_price;
 end if;
 if is_manual is distinct from false then
   raise exception 'Non-manual supplier flag expected false; observed %',is_manual;
 end if;
 if canonical_price is distinct from 3600 then
   raise exception 'Non-manual canonical price expected 3600; observed %',canonical_price;
 end if;
 if (select cost_price_minor from public.club_commerce_products where id=(select club_product_id from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-VAN') and organisation_id=o) is distinct from 2000 then
   raise exception 'Generated-price propagation changed canonical supplier cost';
 end if;
 if (select count(*) from public.club_commerce_products
     where organisation_id=o and supplier_reference like 'supplier_product:%')<>3 then
   raise exception 'Repeat linker created duplicate canonical commerce products';
 end if;
 if (select pack_quantity from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>12
   or (select trade_cost_ex_vat_minor from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>2100
   or (select parent_image_url from public.club_supplier_parent_products where organisation_id=o and parent_key='test|whey protein')<>'https://images.example.test/whey-parent.jpg'
   or (select variant_image_url from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>'https://images.example.test/whey-choc.jpg'
   or (select source_url from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>'https://supplier.example.test/whey' then
   raise exception 'Repeat import failed to refresh supplier fields or preserve pack and media data';
 end if;
 if exists(select 1 from public.club_stock_movements where organisation_id=o and product_id=snapshot.canonical_product_id)
   or (select count(*) from public.club_stock_movements where organisation_id=o and product_id=snapshot.local_product_id)<>1 then
   raise exception 'Supplier availability update created an unintended local stock movement';
 end if;
end $$;

-- Full-catalogue link scale regression: create all 852 families / 3,228 variants
-- through the real import RPC, then establish 64 pre-existing canonical links
-- using privileged fixture setup. The repeat import uses the same payload
-- identities/SKUs with changed commercial and availability fields.
create temporary table _r12_active_sports_scale_rows(sku text primary key,payload jsonb);
insert into pg_temp._r12_active_sports_scale_rows(sku,payload)
select 'R12-SCALE-'||lpad(g::text,5,'0'),
       jsonb_build_object(
         'name','Scale Product '||lpad((((g-1)%852)+1)::text,4,'0'),
         'parentKey','scale-family-'||lpad((((g-1)%852)+1)::text,4,'0'),
         'brand','Scale Brand','category','Supplements','subcategory','Scale',
         'description','Scale fixture variant','size','Size '||g::text,
         'flavour','Variant '||lpad(g::text,4,'0'),
         'supplierSku','R12-SCALE-'||lpad(g::text,5,'0'),
         'packQuantity',1,'memberOrderableUnit','each',
         'availabilityStatus',case when g%5=0 then 'unavailable' else 'available' end,
         'availabilityCheckedAt',now(),'tradeCostExVatMinor',2000,
         'suppliedVatRate',0.2,'notes','PostgreSQL CI scale fixture',
         'discontinued',false
       )
from generate_series(1,3228) g;

grant select on pg_temp._r12_active_sports_scale_rows to authenticated;
set local role authenticated;
select public.club_import_supplier_catalogue_v2(
 '10000000-0000-4000-8000-000000000002','Active Sports Scale','active-sports-scale-initial.csv',
 (select jsonb_agg(payload order by sku) from pg_temp._r12_active_sports_scale_rows),false
);
reset role;

do $$
begin
 if not exists(select 1 from public.club_supplier_import_batches
   where organisation_id='10000000-0000-4000-8000-000000000002'
     and file_name='active-sports-scale-initial.csv'
     and created_count=3228 and updated_count=0 and invalid_count=0) then
   raise exception 'Initial scale import did not create 3,228 variants with zero invalid rows';
 end if;
end $$;

-- Privileged setup models pre-existing canonical links without bypassing the
-- importer identity contract. The production linker still creates the other
-- 3,164 products during its timed call.
insert into public.club_commerce_products(
 organisation_id,sku,name,brand,category,active,stock_tracked,sell_price_minor,
 cost_price_minor,currency,supplier_reference
)
select sp.organisation_id,null,sp.name,sp.brand,sp.category,true,false,
       sp.retail_price_minor,sp.trade_cost_ex_vat_minor,'GBP',
       'supplier_product:'||sp.id::text
from public.club_supplier_products sp
where sp.organisation_id='10000000-0000-4000-8000-000000000002'
  and sp.supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
  and sp.supplier_sku like 'R12-SCALE-%'
  and right(sp.supplier_sku,5)::integer<=64;

update public.club_supplier_products sp
set club_product_id=cp.id
from public.club_commerce_products cp
where sp.organisation_id=cp.organisation_id
  and cp.organisation_id='10000000-0000-4000-8000-000000000002'
  and sp.supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
  and sp.supplier_sku like 'R12-SCALE-%'
  and right(sp.supplier_sku,5)::integer<=64
  and cp.supplier_reference='supplier_product:'||sp.id::text;

-- Exercise an actual manual price among the prelinked rows via the approved
-- capability-checked supplier pricing RPC.
select set_config('r12.active_sports_scale_manual_variant_id',
 (select id::text from public.club_supplier_products
  where organisation_id='10000000-0000-4000-8000-000000000002'
    and supplier_sku='R12-SCALE-00001'),true);
set local role authenticated;
select public.club_set_supplier_variant_retail_price(
 '10000000-0000-4000-8000-000000000002',
 current_setting('r12.active_sports_scale_manual_variant_id')::uuid,7777,true
);
reset role;

do $$
begin
 if (select count(*) from public.club_supplier_parent_products
     where organisation_id='10000000-0000-4000-8000-000000000002'
       and supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
       and parent_key like 'scale-family-%')<>852
   or (select count(*) from public.club_supplier_products
       where organisation_id='10000000-0000-4000-8000-000000000002'
         and supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
         and supplier_sku like 'R12-SCALE-%')<>3228 then
   raise exception 'Scale import did not create 852 families and 3,228 variants';
 end if;
end $$;

set local role authenticated;
do $$
declare started_at timestamptz; elapsed_ms numeric; result jsonb;
begin
 started_at:=clock_timestamp();
 result:=public.club_link_supplier_catalogue_to_commerce(
   '10000000-0000-4000-8000-000000000002','Active Sports Scale'
 );
 elapsed_ms:=extract(epoch from clock_timestamp()-started_at)*1000;
 raise notice 'Active Sports linker scale initial: parents=852 variants=3228 elapsed_ms=% result=%',round(elapsed_ms,1),result;
 if elapsed_ms>10000 then
   raise exception 'Initial 3,228-variant commerce link exceeded 10 seconds: % ms',round(elapsed_ms,1);
 end if;
 if (result->>'created')::integer<>3164 or (result->>'updated')::integer<>64 then
   raise exception 'Scale linker expected 3,164 created and 64 existing; got %',result;
 end if;
end $$;
reset role;

set local role authenticated;
select public.club_import_supplier_catalogue_v2(
 '10000000-0000-4000-8000-000000000002','Active Sports Scale','active-sports-scale-rerun.csv',
 (select jsonb_agg(
    jsonb_set(
      jsonb_set(payload,'{tradeCostExVatMinor}','2100'::jsonb),
      '{availabilityStatus}',to_jsonb(case when payload->>'availabilityStatus'='available' then 'unavailable' else 'available' end)
    ) order by sku
  ) from pg_temp._r12_active_sports_scale_rows),false
);
reset role;

do $$
begin
 if not exists(select 1 from public.club_supplier_import_batches
   where organisation_id='10000000-0000-4000-8000-000000000002'
     and file_name='active-sports-scale-rerun.csv'
     and created_count=0 and updated_count=3228 and invalid_count=0) then
   raise exception 'Scale repeat import did not idempotently update all 3,228 variants';
 end if;
end $$;

set local role authenticated;
do $$
declare started_at timestamptz; elapsed_ms numeric; result jsonb;
begin
 started_at:=clock_timestamp();
 result:=public.club_link_supplier_catalogue_to_commerce(
   '10000000-0000-4000-8000-000000000002','Active Sports Scale'
 );
 elapsed_ms:=extract(epoch from clock_timestamp()-started_at)*1000;
 raise notice 'Active Sports linker scale repeat: parents=852 variants=3228 elapsed_ms=% result=%',round(elapsed_ms,1),result;
 if elapsed_ms>10000 then
   raise exception 'Repeat 3,228-variant commerce link exceeded 10 seconds: % ms',round(elapsed_ms,1);
 end if;
 if (result->>'created')::integer<>0 or (result->>'updated')::integer<>3228 then
   raise exception 'Repeat scale linker expected 0 created and 3,228 existing; got %',result;
 end if;
end $$;
reset role;

do $$
begin
 if (select count(*) from public.club_commerce_products
     where organisation_id='10000000-0000-4000-8000-000000000002'
       and supplier_reference in (
         select 'supplier_product:'||sp.id::text from public.club_supplier_products sp
         where sp.organisation_id='10000000-0000-4000-8000-000000000002'
           and sp.supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
           and sp.supplier_sku like 'R12-SCALE-%'
       ))<>3228 then
   raise exception 'Scale repeat linker duplicated or lost canonical sales units';
 end if;
 if not exists(
   select 1 from public.club_supplier_products sp
   join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
   where sp.organisation_id='10000000-0000-4000-8000-000000000002'
     and sp.supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
     and sp.supplier_sku='R12-SCALE-00001'
     and sp.manual_price=true and sp.retail_price_minor=7777 and cp.sell_price_minor=7777
 ) then raise exception 'Scale repeat import/link changed manual supplier pricing'; end if;
 if not exists(
   select 1 from public.club_supplier_products sp
   join public.club_commerce_products cp on cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id
   where sp.organisation_id='10000000-0000-4000-8000-000000000002'
     and sp.supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
     and sp.supplier_sku='R12-SCALE-00128'
     and sp.manual_price=false and sp.retail_price_minor=3600 and cp.sell_price_minor=3600
     and sp.trade_cost_ex_vat_minor=2100 and cp.cost_price_minor=2000
 ) then raise exception 'Scale generated price/cost propagation did not remain authoritative'; end if;
 if exists(select 1 from public.club_stock_movements
   where organisation_id='10000000-0000-4000-8000-000000000002'
     and product_id in (select club_product_id from public.club_supplier_products
       where organisation_id='10000000-0000-4000-8000-000000000002'
         and supplier_id=(select id from public.club_suppliers where organisation_id='10000000-0000-4000-8000-000000000002' and name='Active Sports Scale')
         and supplier_sku like 'R12-SCALE-%')) then
   raise exception 'Scale supplier linking wrote local physical stock movements';
 end if;
 if not exists(
   select 1 from active_sports_import_preservation_snapshot snap
   where snap.local_on_hand=11
     and (select coalesce(sum(sm.quantity_delta),0) from public.club_stock_movements sm
       where sm.organisation_id='10000000-0000-4000-8000-000000000002' and sm.product_id=snap.local_product_id)=11
 ) then raise exception 'Scale import/link changed the separate local stock fixture from 11 units'; end if;
end $$;
drop table pg_temp._r12_active_sports_scale_rows;

rollback;
