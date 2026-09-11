-- Reviewed artifact only. Apply after 2026-10-16-member-catalogue-enrichment-read.sql.
-- Extends canonical supplier offers, price history and cost history; no inventory writes.
begin;
alter table public.club_supplier_products
  add column if not exists import_identity text,
  add column if not exists trade_cost_ex_vat_minor integer check (trade_cost_ex_vat_minor between 0 and 100000000),
  add column if not exists manual_price boolean not null default false,
  add column if not exists local_product_id uuid references public.club_commerce_products(id) on delete restrict,
  add column if not exists cost_source text;
create unique index if not exists club_supplier_products_id_org_uq on public.club_supplier_products(id,organisation_id);
create unique index if not exists club_suppliers_id_org_uq on public.club_suppliers(id,organisation_id);
create unique index if not exists club_supplier_parents_id_org_uq on public.club_supplier_parent_products(id,organisation_id);
alter table public.club_supplier_products add constraint club_supplier_canonical_product_scope_fk foreign key(club_product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_products add constraint club_supplier_local_product_scope_fk foreign key(local_product_id,organisation_id) references public.club_commerce_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_products add constraint club_supplier_offer_supplier_scope_fk foreign key(supplier_id,organisation_id) references public.club_suppliers(id,organisation_id) on delete restrict;
alter table public.club_supplier_products add constraint club_supplier_offer_parent_scope_fk foreign key(parent_product_id,organisation_id) references public.club_supplier_parent_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_variant_costs add constraint club_supplier_cost_product_scope_fk foreign key(supplier_product_id,organisation_id) references public.club_supplier_products(id,organisation_id) on delete restrict;
alter table public.club_supplier_variant_prices add constraint club_supplier_price_product_scope_fk foreign key(supplier_product_id,organisation_id) references public.club_supplier_products(id,organisation_id) on delete restrict;
create unique index if not exists club_supplier_import_identity_uq on public.club_supplier_products(organisation_id,supplier_id,import_identity) where import_identity is not null;
-- Keep the stable-reference and no-reference reconciliation probes bounded for full catalogues.
create index if not exists club_supplier_barcode_lookup on public.club_supplier_products(organisation_id,supplier_id,barcode) where barcode is not null;
create index if not exists club_supplier_facts_lookup on public.club_supplier_products(organisation_id,supplier_id,lower(coalesce(brand,'')),lower(name),lower(coalesce(size,'')),lower(coalesce(variant,'')),coalesce(pack_quantity,1),lower(coalesce(member_orderable_unit,'unit')));
-- Existing priced offers are conservatively treated as approved, never overwritten by cost refresh.
update public.club_supplier_products set manual_price=true where retail_price_minor is not null;
alter table public.club_supplier_variant_costs add column if not exists supplied_vat_rate numeric check (supplied_vat_rate between 0 and 1);
alter table public.club_supplier_variant_costs add column if not exists trade_cost_ex_vat_minor integer check (trade_cost_ex_vat_minor >= 0);

create or replace function public.club_supplier_commercial_sync() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare landed integer; floor_minor integer;
begin
  if new.import_identity is null then return new; end if;
  if new.trade_cost_ex_vat_minor is null or new.supplied_vat_rate is null or new.supplied_vat_rate not between 0 and 1 then raise exception 'Supplier commercial data is incomplete' using errcode='22023'; end if;
  landed:=round(new.trade_cost_ex_vat_minor*(1+new.supplied_vat_rate));
  floor_minor:=ceil(landed::numeric/70)*100;
  new.wholesale_cost_minor:=landed;
  if not new.manual_price then new.retail_price_minor:=floor_minor; end if;
  new.sellable:=new.active and not new.discontinued and new.availability_status='available' and new.retail_price_minor>0;
  return new;
end; $$;
revoke all on function public.club_supplier_commercial_sync() from public,anon,authenticated;
create trigger club_supplier_commercial_sync before insert or update on public.club_supplier_products for each row execute function public.club_supplier_commercial_sync();

create or replace function public.club_supplier_commercial_audit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.import_identity is null then return new; end if;
  if tg_op='UPDATE' and old.trade_cost_ex_vat_minor is null and old.wholesale_cost_minor is not null then
    insert into public.club_supplier_variant_costs(organisation_id,supplier_id,supplier_product_id,cost_minor,observed_at,source_reference,created_by)
    values(old.organisation_id,old.supplier_id,old.id,old.wholesale_cost_minor,old.updated_at,'Previous recorded supplier cost; VAT basis not established',auth.uid());
  end if;
  if tg_op='INSERT' or old.trade_cost_ex_vat_minor is distinct from new.trade_cost_ex_vat_minor or old.supplied_vat_rate is distinct from new.supplied_vat_rate then
    insert into public.club_supplier_variant_costs(organisation_id,supplier_id,supplier_product_id,cost_minor,trade_cost_ex_vat_minor,supplied_vat_rate,observed_at,source_reference,created_by)
    values(new.organisation_id,new.supplier_id,new.id,new.wholesale_cost_minor,new.trade_cost_ex_vat_minor,new.supplied_vat_rate,coalesce(new.availability_checked_at,now()),new.cost_source,auth.uid());
  end if;
  -- Only dedicated supplier sales units are synchronised. Local singles and their ledger stay intact.
  if new.club_product_id is not null then
    update public.club_commerce_products set sell_price_minor=new.retail_price_minor,active=new.sellable,updated_at=now()
    where id=new.club_product_id and organisation_id=new.organisation_id and not stock_tracked and cost_price_minor is null
      and (sell_price_minor is distinct from new.retail_price_minor or active is distinct from new.sellable);
  end if;
  return new;
end; $$;
revoke all on function public.club_supplier_commercial_audit() from public,anon,authenticated;
create trigger club_supplier_commercial_audit after insert or update on public.club_supplier_products for each row execute function public.club_supplier_commercial_audit();

-- This is the same importer boundary as v2 with complete validation and real reconciliation.
-- Preview makes no writes. Confirmation checks the reviewed source + current-state fingerprint.
create or replace function public.club_reconcile_active_sports(p_organisation_id uuid,p_file_name text,p_rows jsonb,p_apply boolean default false,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.club_suppliers%rowtype; o public.club_supplier_products%rowtype; pp uuid; cp uuid; r jsonb; prior jsonb; payload jsonb;
  identity_key text; v_parent_key text; ids uuid[]:='{}'; keys text[]:='{}'; available_parents text[]; revision text; result jsonb;
  creates integer:=0; updates integer:=0; unchanged integer:=0; costs integer:=0; stocks integer:=0; omitted integer:=0; manual integer:=0; reviews integer:=0; retired integer:=0;
  trade integer; vat numeric; landed integer; live integer; match_ids uuid[]; all_seen text[]:='{}'; barcode_seen text[]:='{}'; batch uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') then raise exception 'Catalogue and pricing access required' using errcode='42501'; end if;
  if p_apply is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Supply a complete catalogue' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into s from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition');
  if (select count(*) from public.club_suppliers where organisation_id=p_organisation_id and lower(name) in ('active sports','active sports nutrition'))>1 then raise exception 'Multiple Active Sports suppliers require reconciliation before import' using errcode='22023'; end if;
  select md5(p_rows::text||coalesce(jsonb_agg(to_jsonb(sp) order by sp.id)::text,'[]')) into revision from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id;
  if p_apply and p_expected_revision is distinct from revision then raise exception 'Catalogue changed. Review again before confirming.' using errcode='40001'; end if;
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
    -- Stable SKU, then barcode, then full order-unit facts. Never trust a caller-supplied key.
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),''),'barcode:'||nullif(btrim(r->>'barcode'),''),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    if identity_key=any(all_seen) or (nullif(r->>'barcode','') is not null and r->>'barcode'=any(barcode_seen)) then raise exception 'Duplicate exact supplier identity' using errcode='22023'; end if;
    all_seen:=array_append(all_seen,identity_key); barcode_seen:=array_append(barcode_seen,r->>'barcode');
  end loop;
  select array_agg(distinct lower(btrim(value->>'brand'))||'|'||lower(btrim(value->>'name'))) into available_parents from jsonb_array_elements(p_rows) where value->>'stockStatus'='available';
  select count(*) into retired from public.club_supplier_parent_products where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
  if p_apply and s.id is null then
    insert into public.club_suppliers(organisation_id,name,slug,member_orderable) values(p_organisation_id,'Active Sports','active-sports',false) returning * into s;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent_key:=lower(btrim(r->>'brand'))||'|'||lower(btrim(r->>'name'));
    identity_key:=coalesce('sku:'||nullif(btrim(r->>'supplierSku'),''),'barcode:'||nullif(btrim(r->>'barcode'),''),'facts:'||jsonb_build_array(lower(btrim(r->>'brand')),lower(btrim(r->>'name')),lower(btrim(r->>'size')),lower(coalesce(btrim(r->>'flavour'),'')),coalesce((r->>'packQuantity')::integer,1),r->>'memberOrderableUnit')::text);
    select array_agg(sp.id) into match_ids from public.club_supplier_products sp where sp.organisation_id=p_organisation_id and sp.supplier_id=s.id and
      (sp.import_identity=identity_key or (nullif(r->>'supplierSku','') is not null and sp.supplier_sku=r->>'supplierSku') or (nullif(r->>'barcode','') is not null and sp.barcode=r->>'barcode') or
      ((nullif(r->>'supplierSku','') is null or sp.supplier_sku is null or sp.supplier_sku=r->>'supplierSku') and (nullif(r->>'barcode','') is null or sp.barcode is null or sp.barcode=r->>'barcode') and lower(coalesce(sp.brand,''))=lower(r->>'brand') and lower(sp.name)=lower(r->>'name') and lower(coalesce(sp.size,''))=lower(r->>'size') and lower(coalesce(sp.variant,''))=lower(coalesce(r->>'flavour','')) and coalesce(sp.pack_quantity,1)=coalesce((r->>'packQuantity')::integer,1) and lower(coalesce(sp.member_orderable_unit,'unit'))=r->>'memberOrderableUnit'));
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
    select jsonb_object_agg(key,to_jsonb(o)->key) into prior from jsonb_object_keys(payload) key;
    if o.id is null then creates:=creates+1;
    elsif prior=payload and o.import_identity=identity_key then unchanged:=unchanged+1;
    else updates:=updates+1; if o.trade_cost_ex_vat_minor is distinct from trade or o.supplied_vat_rate is distinct from vat then costs:=costs+1; end if; if o.availability_status is distinct from r->>'stockStatus' then stocks:=stocks+1; end if; end if;
    keys:=array_append(keys,identity_key);
    if not p_apply then continue; end if;
    insert into public.club_supplier_parent_products(organisation_id,supplier_id,parent_key,brand,name,description,category,subcategory,source_url,parent_image_url,active)
      values(p_organisation_id,s.id,v_parent_key,r->>'brand',r->>'name',r->>'description',r->>'category',r->>'subcategory',r->>'sourceUrl',r->>'parentImageReference',coalesce(v_parent_key=any(available_parents),false))
      on conflict(organisation_id,supplier_id,parent_key) do update set brand=excluded.brand,name=excluded.name,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,source_url=excluded.source_url,parent_image_url=excluded.parent_image_url,active=excluded.active,archived_at=null where (club_supplier_parent_products.brand,club_supplier_parent_products.name,club_supplier_parent_products.description,club_supplier_parent_products.category,club_supplier_parent_products.subcategory,club_supplier_parent_products.source_url,club_supplier_parent_products.parent_image_url,club_supplier_parent_products.active) is distinct from (excluded.brand,excluded.name,excluded.description,excluded.category,excluded.subcategory,excluded.source_url,excluded.parent_image_url,excluded.active);
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
  stocks:=stocks+(select count(*) from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and availability_status='available' and (not p_apply or not coalesce(import_identity=any(keys),false)));
  select count(*) into omitted from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=s.id and not(id=any(ids)) and (not p_apply or not coalesce(import_identity=any(keys),false)) and (active or availability_status<>'unavailable' or sellable);
  updates:=updates+omitted;
  result:=jsonb_build_object('revision',revision,'proposedCreates',creates,'proposedUpdates',updates,'unchangedRows',unchanged,'supplierCostChanges',costs,'supplierStockChanges',stocks,'productsBecomingFullyUnavailable',retired,'manualLivePricesRetained',manual,'pricingReviewFlags',reviews,'applied',p_apply);
  if p_apply then
    update public.club_supplier_products set active=false,availability_status='unavailable',sellable=false,archived_at=now(),updated_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and not coalesce(import_identity=any(keys),false) and (active or availability_status<>'unavailable' or sellable);
    update public.club_supplier_parent_products set active=false,archived_at=now() where organisation_id=p_organisation_id and supplier_id=s.id and active and not coalesce(club_supplier_parent_products.parent_key=any(available_parents),false);
    update public.club_suppliers set member_orderable=true,active=true where id=s.id;
    insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count,created_count,updated_count,skipped_count) values(p_organisation_id,s.id,coalesce(nullif(p_file_name,''),'active-sports.csv'),auth.uid(),jsonb_array_length(p_rows),creates,updates,unchanged) returning id into batch;
    result:=result||jsonb_build_object('batchId',batch);
  end if;
  return result;
end; $$;
revoke all on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) from public,anon;
grant execute on function public.club_reconcile_active_sports(uuid,text,jsonb,boolean,text) to authenticated;

create or replace function public.club_set_supplier_variant_retail_price(p_organisation_id uuid,p_supplier_product_id uuid,p_retail_price_minor integer,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.club_supplier_products%rowtype;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Pricing access required' using errcode='42501'; end if;
  if p_retail_price_minor is null or p_retail_price_minor not between 1 and 100000000 or p_active is distinct from true then raise exception 'Enter a positive GBP selling price' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text||':supplier-catalogue',0));
  select * into o from public.club_supplier_products where id=p_supplier_product_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Supplier variant not found' using errcode='P0002'; end if;
  if o.manual_price and o.retail_price_minor=p_retail_price_minor then return jsonb_build_object('unchanged',true); end if;
  update public.club_supplier_variant_prices set active=false,effective_to=now() where organisation_id=p_organisation_id and supplier_product_id=o.id and active;
  insert into public.club_supplier_variant_prices(organisation_id,supplier_product_id,retail_price_minor,created_by,effective_from) values(p_organisation_id,o.id,p_retail_price_minor,auth.uid(),clock_timestamp());
  update public.club_supplier_products set retail_price_minor=p_retail_price_minor,manual_price=true,updated_at=now() where id=o.id;
  return jsonb_build_object('retailPriceMinor',p_retail_price_minor,'manualPrice',true);
end; $$;
revoke all on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) from public,anon;
grant execute on function public.club_set_supplier_variant_retail_price(uuid,uuid,integer,boolean) to authenticated;

-- Keep older authorised product editors consistent with the supplier manual-price contract.
create or replace function public.club_supplier_canonical_price_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype;
begin
  select * into offer from public.club_supplier_products where organisation_id=new.organisation_id and club_product_id=new.id and import_identity is not null;
  if not found then return new; end if;
  if new.stock_tracked or new.cost_price_minor is not null then raise exception 'Use the supplier pricing controls for this sales unit' using errcode='22023'; end if;
  if offer.retail_price_minor is distinct from new.sell_price_minor then
    perform public.club_set_supplier_variant_retail_price(new.organisation_id,offer.id,new.sell_price_minor,true);
  end if;
  return new;
end; $$;
revoke all on function public.club_supplier_canonical_price_changed() from public,anon,authenticated;
create trigger club_supplier_canonical_price_changed after update of sell_price_minor,stock_tracked,cost_price_minor on public.club_commerce_products for each row execute function public.club_supplier_canonical_price_changed();

-- Imported current cost is corrected through a reviewed CSV refresh. Preserve the existing
-- history-only cost evidence API, but close its cross-organisation foreign-key gap.
create or replace function public.club_record_supplier_variant_cost(p_organisation_id uuid,p_supplier_id uuid,p_supplier_product_id uuid,p_cost_minor integer,p_currency text,p_observed_at timestamptz,p_source_reference text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier cost access is not permitted' using errcode='42501'; end if;
  if not exists(select 1 from public.club_supplier_products where id=p_supplier_product_id and supplier_id=p_supplier_id and organisation_id=p_organisation_id) then raise exception 'Supplier variant not found' using errcode='P0002'; end if;
  if p_cost_minor is null or p_cost_minor<0 or p_observed_at is null or p_currency is distinct from 'GBP' then raise exception 'Invalid supplier cost evidence' using errcode='22023'; end if;
  insert into public.club_supplier_variant_costs(organisation_id,supplier_id,supplier_product_id,cost_minor,currency,observed_at,source_reference,created_by) values(p_organisation_id,p_supplier_id,p_supplier_product_id,p_cost_minor,p_currency,p_observed_at,p_source_reference,auth.uid()) returning id into v_id;
  return jsonb_build_object('id',v_id);
end; $$;
revoke all on function public.club_record_supplier_variant_cost(uuid,uuid,uuid,integer,text,timestamptz,text) from public,anon;
grant execute on function public.club_record_supplier_variant_cost(uuid,uuid,uuid,integer,text,timestamptz,text) to authenticated;

create or replace function public.club_list_supplier_pricing(p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'commerce.pricing_manage') or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Pricing access required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'club_product_id',sp.club_product_id,'supplier',s.name,'brand',sp.brand,'name',sp.name,'variant',sp.variant,'size',sp.size,'category',sp.category,'supplier_sku',sp.supplier_sku,'barcode',sp.barcode,'availability_status',sp.availability_status,'availability_checked_at',sp.availability_checked_at,'member_orderable_unit',sp.member_orderable_unit,'pack_quantity',sp.pack_quantity,'trade_cost_minor',sp.trade_cost_ex_vat_minor,'vat_rate',sp.supplied_vat_rate,'retail_price_minor',sp.retail_price_minor,'manual_price',sp.manual_price,'cost_source',sp.cost_source,
    'local_stock',coalesce((select sum(i.quantity_delta) from public.club_stock_movements i where i.organisation_id=p_organisation_id and i.product_id=coalesce(sp.local_product_id,sp.club_product_id)),0),
    'cost_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from (select c.cost_minor,c.trade_cost_ex_vat_minor,c.supplied_vat_rate,c.source_reference,c.observed_at,c.created_at from public.club_supplier_variant_costs c where c.organisation_id=p_organisation_id and c.supplier_product_id=sp.id order by c.created_at desc limit 10) h),'[]'::jsonb)) order by s.name,sp.name,sp.size,sp.variant),'[]'::jsonb) into result
  from public.club_supplier_products sp join public.club_suppliers s on s.id=sp.supplier_id and s.organisation_id=sp.organisation_id where sp.organisation_id=p_organisation_id;
  return result;
end; $$;
revoke all on function public.club_list_supplier_pricing(uuid) from public,anon;
grant execute on function public.club_list_supplier_pricing(uuid) to authenticated;

create or replace function public.club_list_member_supplier_catalogue(p_organisation_id uuid, p_location_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'parentKey',pp.parent_key,'supplierId',s.id,'supplierName',s.name,'memberOrderable',s.member_orderable,
  'brand',pp.brand,'name',pp.name,'description',pp.description,'category',pp.category,'subcategory',pp.subcategory,
  'sourceUrl',pp.source_url,'imageReference',pp.parent_image_url,
  'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'clubProductId',sp.club_product_id,'localStockTracked',coalesce((select cp.stock_tracked from public.club_commerce_products cp where cp.id=sp.club_product_id and cp.organisation_id=sp.organisation_id),false),'supplierId',s.id,'parentKey',pp.parent_key,'flavour',sp.variant,'size',sp.size,'packQuantity',sp.pack_quantity,'supplierSku',sp.supplier_sku,'barcode',sp.barcode,'stockStatus',sp.availability_status,'availabilityCheckedAt',sp.availability_checked_at,'memberOrderableUnit',sp.member_orderable_unit,'imageReference',sp.variant_image_url,'retailPriceMinor',sp.retail_price_minor) order by sp.size,sp.variant),'[]'::jsonb) from public.club_supplier_products sp where sp.organisation_id=pp.organisation_id and sp.parent_product_id=pp.id and sp.active and not sp.discontinued)
) order by pp.name),'[]'::jsonb)
from public.club_supplier_parent_products pp join public.club_suppliers s on s.id=pp.supplier_id
where pp.organisation_id=p_organisation_id and pp.active and pp.archived_at is null and s.active and s.member_orderable and exists(select 1 from public.club_supplier_products available where available.organisation_id=pp.organisation_id and available.parent_product_id=pp.id and available.active and available.sellable and not available.discontinued and available.availability_status='available') and exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and m.active);
$$;
revoke all on function public.club_list_member_supplier_catalogue(uuid,uuid) from public,anon; grant execute on function public.club_list_member_supplier_catalogue(uuid,uuid) to authenticated;


-- The order writer already locks and prices canonical products. This narrow guard
-- protects every order-item insertion, including stale baskets and direct RPC calls.
create or replace function public.club_guard_supplier_order_item() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare offer public.club_supplier_products%rowtype;
begin
  select sp.* into offer from public.club_supplier_products sp where sp.organisation_id=new.organisation_id and sp.club_product_id=new.product_id and sp.import_identity is not null for share;
  if found and (not offer.active or not offer.sellable or offer.discontinued or offer.availability_status<>'available' or not exists(select 1 from public.club_suppliers s where s.id=offer.supplier_id and s.organisation_id=new.organisation_id and s.active and s.member_orderable)) then raise exception 'This supplier option is currently unavailable' using errcode='22023'; end if;
  return new;
end; $$;
revoke all on function public.club_guard_supplier_order_item() from public,anon,authenticated;
create trigger club_guard_supplier_order_item before insert on public.club_order_items for each row execute function public.club_guard_supplier_order_item();
-- Keep generic supplier imports available while requiring the final-file gate for Active Sports.
alter function public.club_import_supplier_catalogue(uuid,text,text,jsonb) rename to club_import_supplier_catalogue_legacy_v1;
revoke all on function public.club_import_supplier_catalogue_legacy_v1(uuid,text,text,jsonb) from public,anon,authenticated;
create function public.club_import_supplier_catalogue(p_organisation_id uuid,p_supplier_name text,p_file_name text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Catalogue access required' using errcode='42501'; end if;
  if lower(btrim(p_supplier_name)) in ('active sports','active sports nutrition') then raise exception 'Use reviewed Active Sports reconciliation' using errcode='22023'; end if;
  return public.club_import_supplier_catalogue_legacy_v1(p_organisation_id,p_supplier_name,p_file_name,p_rows);
end; $$;
revoke all on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) from public,anon;
grant execute on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) to authenticated;
alter function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) rename to club_import_supplier_catalogue_legacy_v2;
revoke all on function public.club_import_supplier_catalogue_legacy_v2(uuid,text,text,jsonb,boolean) from public,anon,authenticated;
create function public.club_import_supplier_catalogue_v2(p_organisation_id uuid,p_supplier_name text,p_file_name text,p_rows jsonb,p_reconcile boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Catalogue access required' using errcode='42501'; end if;
  if lower(btrim(p_supplier_name)) in ('active sports','active sports nutrition') then raise exception 'Use reviewed Active Sports reconciliation' using errcode='22023'; end if;
  return public.club_import_supplier_catalogue_legacy_v2(p_organisation_id,p_supplier_name,p_file_name,p_rows,p_reconcile);
end; $$;
revoke all on function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) from public,anon;
grant execute on function public.club_import_supplier_catalogue_v2(uuid,text,text,jsonb,boolean) to authenticated;
commit;
