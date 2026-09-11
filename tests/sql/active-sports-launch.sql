-- Run ONLY on a disposable local database with the repository migrations applied.
-- psql "$R12_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/active-sports-launch.sql
-- The fixtures and all catalogue mutations roll back; this is not a production import.
begin;
do $$
declare org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid();
  source jsonb; preview jsonb; outcome jsonb; offers jsonb; member_catalogue jsonb; variant_id uuid; supplier_id uuid; canonical_id uuid;
  local_id uuid; order_id uuid; count_before integer; revision text;
begin
  insert into auth.users(id) values(owner_id),(member_id);
  insert into public.club_organisations(id,name,slug) values(org,'Supplier regression fixture','supplier-regression-'||org);
  insert into public.club_locations(id,organisation_id,name) values(location_id,org,'Regression venue');
  insert into public.club_members(organisation_id,user_id,role) values(org,owner_id,'owner'),(org,member_id,'member');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  source:=jsonb_build_array(jsonb_build_object('supplier','Active Sports','brand','Test Brand','name','Test Case','category','Supplements','size','12 x 60g','flavour','Chocolate','packQuantity',12,'memberOrderableUnit','case','stockStatus','available','availabilityCheckedAt','2026-09-10T00:00:00Z','currentBoldTradeCostExVatMinor',2000,'purchaseVatRate',0.2,'costSourceSnapshot','Regression fixture'));
  source:=source||jsonb_build_array(source->0||jsonb_build_object('flavour','Vanilla','stockStatus','unavailable'))||jsonb_build_array(source->0||jsonb_build_object('name','Wholly unavailable','stockStatus','unavailable'));
  preview:=public.club_reconcile_active_sports(org,'fixture.csv',source,false,null);
  if (preview->>'proposedCreates')::integer<>2 then raise exception 'Expected two variants beneath one available parent'; end if;
  if exists(select 1 from public.club_suppliers where organisation_id=org) then raise exception 'Preview wrote data'; end if;
  outcome:=public.club_reconcile_active_sports(org,'fixture.csv',source,true,preview->>'revision');
  select id,club_product_id,sp.supplier_id into variant_id,canonical_id,supplier_id from public.club_supplier_products sp where organisation_id=org and variant='Chocolate';
  if (select retail_price_minor from public.club_supplier_products where id=variant_id)<>3500 then raise exception 'VAT inclusive margin floor is incorrect'; end if;
  if (select wholesale_cost_minor from public.club_supplier_products where id=variant_id)<>2400 then raise exception 'True cost is incorrect'; end if;
  if exists(select 1 from public.club_supplier_parent_products where organisation_id=org and name='Wholly unavailable') then raise exception 'Wholly unavailable parent imported'; end if;
  if (select stock_tracked from public.club_commerce_products where id=canonical_id) then raise exception 'Supplier case was made local stock'; end if;
  preview:=public.club_reconcile_active_sports(org,'fixture.csv',source,false,null);
  if (preview->>'proposedCreates')::integer<>0 or (preview->>'proposedUpdates')::integer<>0 or (preview->>'unchangedRows')::integer<>2 then raise exception 'Repeated import not idempotent: %',preview; end if;
  select count(*) into count_before from public.club_supplier_variant_costs where organisation_id=org;
  perform public.club_reconcile_active_sports(org,'fixture.csv',source,true,preview->>'revision');
  if (select count(*) from public.club_supplier_variant_costs where organisation_id=org)<>count_before then raise exception 'Repeated import duplicated cost history'; end if;
  perform public.club_set_supplier_variant_retail_price(org,variant_id,3000,true);
  source:=jsonb_set(source,'{0,currentBoldTradeCostExVatMinor}','3000');
  preview:=public.club_reconcile_active_sports(org,'fixture.csv',source,false,null);
  if (preview->>'manualLivePricesRetained')::integer<>1 or (preview->>'pricingReviewFlags')::integer<>1 then raise exception 'Manual price review missing'; end if;
  perform public.club_reconcile_active_sports(org,'fixture.csv',source,true,preview->>'revision');
  if (select retail_price_minor from public.club_supplier_products where id=variant_id)<>3000 then raise exception 'Manual live price overwritten'; end if;
  if (select sell_price_minor from public.club_commerce_products where id=canonical_id)<>3000 then raise exception 'Checkout price not synchronised'; end if;
  if (select count(*) from public.club_supplier_variant_costs where organisation_id=org)<>count_before+1 then raise exception 'Cost change history missing'; end if;
  offers:=public.club_list_supplier_pricing(org);
  if jsonb_array_length(offers)<>2 then raise exception 'Management read missing variants'; end if;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  begin perform public.club_list_supplier_pricing(org); raise exception 'Member read private supplier pricing'; exception when insufficient_privilege then null; end;
  begin perform public.club_set_supplier_variant_retail_price(org,variant_id,1,true); raise exception 'Member changed selling price'; exception when insufficient_privilege then null; end;
  begin perform public.club_record_supplier_variant_cost(org,supplier_id,variant_id,1,'GBP',now(),'bad'); raise exception 'Member changed cost evidence'; exception when insufficient_privilege then null; end;
  begin perform public.club_reconcile_active_sports(org,'fixture.csv',source,true,'bad'); raise exception 'Member imported catalogue'; exception when insufficient_privilege then null; end;
  member_catalogue:=public.club_list_member_supplier_catalogue(org,null);
  if jsonb_array_length(member_catalogue)<>1 or jsonb_array_length(member_catalogue->0->'variants')<>2 then raise exception 'Member catalogue grouping or unavailable sibling missing'; end if;
  if member_catalogue::text ~ 'trade_cost|wholesale_cost|supplied_vat|manual_price|cost_history' then raise exception 'Member commercial data leak'; end if;
  select club_product_id into canonical_id from public.club_supplier_products where organisation_id=org and variant='Vanilla';
  begin
    perform public.club_create_commerce_order(org,location_id,null,'member_app','GBP',jsonb_build_array(jsonb_build_object('product_id',canonical_id,'quantity',1)),'unavailable-test');
    raise exception 'Unavailable sibling was orderable';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.club_commerce_products(organisation_id,name,stock_tracked,sell_price_minor,currency) values(org,'Local single',true,400,'GBP') returning id into local_id;
  insert into public.club_stock_movements(organisation_id,location_id,product_id,movement_type,quantity_delta,reason,actor_user_id) values(org,location_id,local_id,'stocktake_adjustment',7,'Regression fixture',owner_id);
  source:=jsonb_set(source,'{0,stockStatus}','"unavailable"');
  preview:=public.club_reconcile_active_sports(org,'fixture.csv',source,false,null);
  if (preview->>'productsBecomingFullyUnavailable')::integer<>1 then raise exception 'Parent retirement missing from preview'; end if;
  perform public.club_reconcile_active_sports(org,'fixture.csv',source,true,preview->>'revision');
  if (select sum(quantity_delta) from public.club_stock_movements where organisation_id=org and product_id=local_id)<>7 then raise exception 'Supplier stock changed local stock'; end if;
  if (select sell_price_minor from public.club_commerce_products where id=local_id)<>400 then raise exception 'Supplier price changed local price'; end if;
  outcome:=public.club_create_commerce_order(org,location_id,null,'staff_checkout','GBP',jsonb_build_array(jsonb_build_object('product_id',local_id,'quantity',1)),'local-pos-test');
  if (outcome->'order'->>'total_minor')::integer<>400 then raise exception 'Local POS order regressed'; end if;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  if jsonb_array_length(public.club_list_member_supplier_catalogue(org,null))<>0 then raise exception 'Fully unavailable parent remains visible'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  -- A changed catalogue invalidates an earlier review, even when the CSV is unchanged.
  preview:=public.club_reconcile_active_sports(org,'fixture.csv',source,false,null);
  perform public.club_set_supplier_variant_retail_price(org,variant_id,3200,true);
  begin perform public.club_reconcile_active_sports(org,'fixture.csv',source,true,preview->>'revision'); raise exception 'Stale review accepted'; exception when serialization_failure then null; end;
end; $$;
rollback;
