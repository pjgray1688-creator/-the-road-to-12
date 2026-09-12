-- Allow the trusted service-role worker while preserving authenticated capability checks.
begin;

create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; parent_keys_done text[]:='{}'; revision text; result jsonb; started_at timestamptz:=clock_timestamp(); stage_at timestamptz:=clock_timestamp(); timings jsonb:='{}';
  import_job_id uuid; stmt_started timestamptz;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; seen_records jsonb[]:='{}'; seen_rows integer[]:='{}'; duplicate_diagnostics jsonb:='[]'; source_row integer:=1; batch uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage')) then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select id into import_job_id from public.club_import_jobs where organisation_id=p_organisation_id and filename=p_file_name and status='running' order by created_at desc limit 1;
  stmt_started:=clock_timestamp();
  create temporary table worker_supplier_products on commit drop as select * from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id;
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','stage supplier products','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  stmt_started:=clock_timestamp();
  create index worker_supplier_products_identity_idx on worker_supplier_products(import_identity);
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','index staged supplier identity','elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
  raise notice '[active-sports] csv load % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('csvLoadMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'snapshot complete',jsonb_build_object('elapsedMs',timings->'csvLoadMs')); end if;
  -- Revalidate every field at the database boundary, including direct authenticated RPC callers.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object' or coalesce(r->>'supplier','') not in ('Active Sports','Active Sports Nutrition')
      or coalesce(btrim(r->>'name'),'')='' or coalesce(btrim(r->>'brand'),'')='' or coalesce(btrim(r->>'category'),'')=''
      or coalesce(btrim(r->>'size'),'')='' or coalesce(btrim(r->>'costSourceSnapshot'),'')=''
      or coalesce(r->>'stockStatus','') not in ('available','unavailable')
      or coalesce(r->>'memberOrderableUnit','') not in ('unit','each','tub','pack','case','box')
      or coalesce(r->>'currentBoldTradeCostExVatMinor','') !~ '^\d+$'
      or coalesce(r->>'purchaseVatRate','') !~ '^\d+(\.\d+)?$'
      or coalesce(r->>'availabilityCheckedAt','')='' then raise exception 'Incomplete supplier row' using errcode='22023'; end if;
    if nullif(r->>'barcode','') is not null and r->>'barcode' !~ '^\d{8,14}$' then raise exception 'Invalid barcode' using errcode='22023'; end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric;
    if trade not between 0 and 100000000 or vat not between 0 and 1 then raise exception 'Invalid cost or VAT' using errcode='22023'; end if;
    perform (r->>'availabilityCheckedAt')::timestamptz;
    if exists(select 1 from jsonb_each_text(r) field where field.key in ('sourceUrl','parentImageReference','variantImageReference') and nullif(field.value,'') is not null and field.value !~ '^https?://[^[:space:]]+$') then raise exception 'Invalid source or image URL' using errcode='22023'; end if;
    if coalesce(r->>'packQuantity','1') !~ '^\d+$' or coalesce((r->>'packQuantity')::integer,1)<1 or (r->>'memberOrderableUnit' in ('case','box','pack') and r->>'packQuantity' is null) then raise exception 'Invalid supplier pack quantity' using errcode='22023'; end if;
    -- SKU/barcode are linking metadata; flavour/variant and size make the sellable identity.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) then
      duplicate_diagnostics:=duplicate_diagnostics||jsonb_build_array(jsonb_build_object('identityKey',identity_key,'records',jsonb_build_array(seen_records[array_position(all_seen,identity_key)]||jsonb_build_object('csvRow',seen_rows[array_position(all_seen,identity_key)]),r||jsonb_build_object('csvRow',source_row+1))));
    else
      all_seen:=array_append(all_seen,identity_key); seen_records:=array_append(seen_records,r); seen_rows:=array_append(seen_rows,source_row+1);
    end if;
    source_row:=source_row+1;
  end loop;
  raise notice '[active-sports] validation % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('validationMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'identity matching complete',jsonb_build_object('elapsedMs',timings->'validationMs')); insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'duplicate handling complete',jsonb_build_object('elapsedMs',timings->'validationMs')); end if;
  if jsonb_array_length(duplicate_diagnostics)>0 then raise exception 'Duplicate exact supplier identity diagnostics: %',duplicate_diagnostics::text using errcode='22023'; end if;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'barcode:'||nullif(btrim(r->>'barcode'),'')||':brand:'||lower(btrim(r->>'brand'))||':variant:'||lower(coalesce(nullif(btrim(r->>'flavour'),''),btrim(r->>'name')))||':size:'||lower(btrim(r->>'size')),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    stmt_started:=clock_timestamp();
    select array_agg(sp.id) into match_ids from worker_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit' and (nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode')));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','supplier identity match','row',source_row,'elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    if cardinality(match_ids)>1 then raise exception 'Ambiguous existing supplier identity. No changes applied.' using errcode='22023'; end if;
    select * into o from public.club_supplier_products where id=match_ids[1];
    if o.id is not null and o.id=any(ids) then raise exception 'Multiple source rows match one stored variant' using errcode='22023'; end if;
    if o.id is null and not coalesce(v_parent_key=any(available_parents),false) then continue; end if;
    if o.id is not null then ids:=array_append(ids,o.id); end if;
    trade:=(r->>'currentBoldTradeCostExVatMinor')::integer; vat:=(r->>'purchaseVatRate')::numeric; landed:=round(trade*(1+vat));
    live:=case when o.manual_price then o.retail_price_minor else ceil(landed::numeric/70)*100 end;
    if o.manual_price then manual:=manual+1; end if;
    if live is null or live<=0 or live<ceil(landed::numeric/70)*100 then reviews:=reviews+1; end if;
    payload:=jsonb_build_object('brand',r->>'brand','name',r->>'name','variant',nullif(r->>'flavour',''),'size',r->>'size','description',nullif(r->>'description',''),'category',r->>'category','supplier_sku',nullif(r->>'supplierSku',''),'barcode',nullif(r->>'barcode',''),'pack_quantity',coalesce((r->>'packQuantity')::integer,1),'member_orderable_unit',r->>'memberOrderableUnit','availability_status',r->>'stockStatus','availability_checked_at',(r->>'availabilityCheckedAt')::timestamptz,'trade_cost_ex_vat_minor',trade,'supplied_vat_rate',vat,'cost_source',r->>'costSourceSnapshot','source_url',nullif(r->>'sourceUrl',''),'variant_image_url',nullif(r->>'variantImageReference',''),'active',coalesce(v_parent_key=any(available_parents),false),'source_metadata',jsonb_build_object('parent_key',v_parent_key,'parent_image_url',r->>'parentImageReference','subcategory',r->>'subcategory','notes',r->>'notes','image_status',r->>'imageStatus'));
    stmt_started:=clock_timestamp();
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'statement completed',jsonb_build_object('statement','prior supplier projection','row',source_row,'elapsedMs',extract(milliseconds from clock_timestamp()-stmt_started))); end if;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    if not (v_parent_key=any(parent_keys_done)) then
      insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
        values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
        on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
      parent_keys_done:=array_append(parent_keys_done,v_parent_key);
    end if;
    select id into pp from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and club_supplier_parent_products.parent_key=v_parent_key;
    if o.id is null then
      insert into public.club_supplier_products(organisation_id,supplier_id,parent_product_id,import_identity,name,trade_cost_ex_vat_minor,supplied_vat_rate,cost_source,availability_checked_at) values(p_organisation_id,s.id,pp,identity_key,r->>'name',trade,vat,r->>'costSourceSnapshot',(r->>'availabilityCheckedAt')::timestamptz) returning * into o;
    end if;
    if prior is distinct from payload or o.import_identity is distinct from identity_key or o.parent_product_id is distinct from pp then
      update public.club_supplier_products set parent_product_id=pp,import_identity=identity_key,brand=r->>'brand',name=r->>'name',variant=nullif(r->>'flavour',''),size=r->>'size',description=nullif(r->>'description',''),category=r->>'category',supplier_sku=nullif(r->>'supplierSku',''),barcode=nullif(r->>'barcode',''),pack_quantity=coalesce((r->>'packQuantity')::integer,1),member_orderable_unit=r->>'memberOrderableUnit',availability_status=r->>'stockStatus',availability_checked_at=(r->>'availabilityCheckedAt')::timestamptz,trade_cost_ex_vat_minor=trade,supplied_vat_rate=vat,cost_source=r->>'costSourceSnapshot',source_url=nullif(r->>'sourceUrl',''),variant_image_url=nullif(r->>'variantImageReference',''),source_metadata=payload->'source_metadata',active=coalesce(v_parent_key=any(available_parents),false),discontinued=false,archived_at=null,updated_at=now() where id=o.id returning * into o;
    end if;
    if o.club_product_id is null or exists(select 1 from public.club_commerce_products where id=o.club_product_id and (stock_tracked or cost_price_minor is not null)) then
      insert into public.club_commerce_products(organisation_id,name,brand,category,description,active,stock_tracked,sell_price_minor,currency)
        values(p_organisation_id,concat_ws(' · ',o.name,o.size,o.variant,o.member_orderable_unit),o.brand,o.category,o.description,o.sellable,false,o.retail_price_minor,'GBP') returning id into cp;
      update public.club_supplier_products set local_product_id=coalesce(local_product_id,club_product_id),club_product_id=cp where id=o.id;
    end if;
  end loop;
  raise notice '[active-sports] supplier product upsert % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('supplierProductUpsertMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'reconciliation complete',jsonb_build_object('elapsedMs',timings->'supplierProductUpsertMs')); end if;
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  raise notice '[active-sports] availability and retirement % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('availabilityRetirementMs',extract(milliseconds from clock_timestamp()-stage_at)); stage_at:=clock_timestamp();
  if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'pricing complete',jsonb_build_object('elapsedMs',timings->'availabilityRetirementMs')); end if;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  if p_apply then
    stage_at:=clock_timestamp();
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    raise notice '[active-sports] publication % ms', extract(milliseconds from clock_timestamp()-stage_at); timings:=timings||jsonb_build_object('publicationMs',extract(milliseconds from clock_timestamp()-stage_at));
    if import_job_id is not null then insert into public.club_import_job_logs(job_id,message,metadata) values(import_job_id,'publish complete',jsonb_build_object('elapsedMs',timings->'publicationMs')); end if;
    result:=result||jsonb_build_object('batchId',batch,'stageTimingsMs',timings,'totalMs',extract(milliseconds from clock_timestamp()-started_at));
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

commit;
