-- Real PostgreSQL exercise of the import RPC and its following commerce link.
-- This fixture is transactional and must run only in disposable CI databases.
begin;
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000001','catalogue-manager@example.test');
insert into public.club_organisations(id,name,slug) values ('10000000-0000-4000-8000-000000000002','Active Sports RPC fixture','active-sports-rpc-fixture');
insert into public.club_locations(id,organisation_id,name) values ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','RPC Test Location');
insert into public.club_members(organisation_id,user_id,role) values ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','owner');
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

-- Create a normal locally-stocked POS product through the product-management RPC,
-- then record its opening delivery via the audited stock-adjustment RPC.
do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; local_product uuid; saved jsonb;
begin
 saved:=public.club_save_pos_product(
   null,o,'LOCAL-WHEY-001',null,'Local Whey Case Shelf Stock','Test Brand',null,
   'Supplements',true,true,7777,null,'GBP',null,null,'{}'::jsonb,
   array['pos']::text[],'case',null,null,false,null,null
 );
 local_product:=(saved->>'id')::uuid;
 perform public.club_adjust_inventory(
   o,'10000000-0000-4000-8000-000000000003',local_product,
   'delivery',11,'CI opening stock fixture','active-sports-ci-stock-11'
 );
end $$;
reset role;

do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; p uuid;
begin
 select club_product_id into p from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC';
 if (select retail_price_minor from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>7777
   or not (select manual_price from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC') then
   raise exception 'Supported supplier pricing flow did not set the approved manual price';
 end if;
 if p is null then raise exception 'Linked supplier commerce product disappeared'; end if;
end $$;

create temporary table active_sports_import_preservation_snapshot as
select sp.id as supplier_product_id,sp.club_product_id as canonical_product_id,cp.sell_price_minor as canonical_price_minor,
       cp.stock_tracked as canonical_stock_tracked,
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
select public.club_link_supplier_catalogue_to_commerce('10000000-0000-4000-8000-000000000002','Active Sports');
reset role;

do $$
declare o uuid:='10000000-0000-4000-8000-000000000002'; snapshot record;
begin
 if (select count(*) from public.club_supplier_parent_products where organisation_id=o)<>2
   or (select count(*) from public.club_supplier_products where organisation_id=o)<>3 then
   raise exception 'Repeat import duplicated parent or exact variant rows';
 end if;
 if not exists(select 1 from public.club_supplier_import_batches where organisation_id=o and file_name='active-sports-ci-rerun.csv' and created_count=0 and updated_count=3) then
   raise exception 'Repeat import did not update all exact variants';
 end if;
 select * into strict snapshot from active_sports_import_preservation_snapshot;
 if (select retail_price_minor from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')<>7777
   or not (select manual_price from public.club_supplier_products where organisation_id=o and supplier_sku='AS-CASE-CHOC')
   or (select sell_price_minor from public.club_commerce_products where id=snapshot.canonical_product_id) is distinct from snapshot.canonical_price_minor then
   raise exception 'Import/link overwrote a management-approved retail price';
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
rollback;
