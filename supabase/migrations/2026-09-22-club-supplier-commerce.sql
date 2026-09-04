-- Supplier catalogue and order-to-collection domain. Review and execute in a controlled environment.
create table if not exists public.club_suppliers (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null, active boolean not null default true, ordering_config jsonb not null default '{}'::jsonb,
  delivery_config jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists club_suppliers_org_name_uq on public.club_suppliers(organisation_id, lower(name));
create table if not exists public.club_supplier_products (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade, club_product_id uuid references public.club_commerce_products(id) on delete set null, supplier_sku text, barcode text, brand text,
  name text not null, variant text, size text, description text, category text, wholesale_cost_minor integer, supplied_vat_rate numeric,
  supplier_rrp_minor integer, supplier_availability integer, image_url text, supplier_url text, discontinued boolean not null default false,
  sellable boolean not null default false, fulfilment_type text not null default 'supplier_order_for_collection', retail_price_minor integer,
  source_metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint club_supplier_products_fulfilment_ck check (fulfilment_type in ('stocked_at_location','supplier_order_for_collection','dropship'))
);
create unique index if not exists club_supplier_products_sku_uq on public.club_supplier_products(organisation_id,supplier_id,supplier_sku) where supplier_sku is not null;
-- Barcodes identify canonical Club products; multiple suppliers may offer one barcode.
create table if not exists public.club_supplier_import_batches (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade, file_name text not null, imported_by uuid not null,
  row_count integer not null default 0, created_count integer not null default 0, updated_count integer not null default 0,
  skipped_count integer not null default 0, invalid_count integer not null default 0, conflict_count integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.club_supplier_demand (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id), supplier_product_id uuid not null references public.club_supplier_products(id),
  order_id uuid not null references public.club_orders(id) on delete restrict, order_item_id uuid references public.club_order_items(id) on delete restrict, user_id uuid, collection_location_id uuid references public.club_locations(id) on delete restrict,
  quantity_required integer not null check (quantity_required > 0), quantity_received integer not null default 0 check (quantity_received >= 0),
  quantity_allocated integer not null default 0 check (quantity_allocated >= 0), status text not null default 'outstanding', ordered_at timestamptz,
  received_at timestamptz, ready_at timestamptz, collected_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint club_supplier_demand_status_ck check (status in ('outstanding','ordered','awaiting_delivery','received','ready_for_collection','collected','cancelled'))
);
create unique index if not exists club_supplier_demand_order_item_uq on public.club_supplier_demand(order_item_id) where order_item_id is not null;
create table if not exists public.club_notification_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null, event_type text not null, order_id uuid, state text not null default 'queued', payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz, attempted_at timestamptz, provider text, provider_reference text, created_at timestamptz not null default now(),
  constraint club_notification_events_state_ck check (state in ('queued','sent','delivered','failed','retrying','manual_review'))
);
create unique index if not exists club_notification_ready_once_uq on public.club_notification_events(order_id,event_type) where event_type='order_ready_for_collection';
alter table public.club_suppliers enable row level security; alter table public.club_supplier_products enable row level security;
alter table public.club_supplier_import_batches enable row level security; alter table public.club_supplier_demand enable row level security; alter table public.club_notification_events enable row level security;
-- Access is intentionally via capability-checked server functions; no browser table grants are added here.
revoke all on public.club_suppliers, public.club_supplier_products, public.club_supplier_import_batches, public.club_supplier_demand, public.club_notification_events from anon, authenticated;

create or replace function public.club_import_supplier_catalogue(p_organisation_id uuid, p_supplier_name text, p_file_name text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_supplier uuid; v_batch uuid; v_row jsonb; v_product uuid; v_created integer:=0; v_updated integer:=0; v_conflicts integer:=0;
begin
  if auth.uid() is null or not public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.catalogue_manage') then raise exception 'Supplier catalogue import is not permitted' using errcode='42501'; end if;
  if p_organisation_id is null or nullif(btrim(p_supplier_name),'') is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then raise exception 'Invalid supplier import' using errcode='22023'; end if;
  insert into public.club_suppliers(organisation_id,name) values(p_organisation_id,btrim(p_supplier_name)) on conflict (organisation_id,lower(name)) do update set active=true,updated_at=now() returning id into v_supplier;
  insert into public.club_supplier_import_batches(organisation_id,supplier_id,file_name,imported_by,row_count) values(p_organisation_id,v_supplier,coalesce(nullif(btrim(p_file_name),''),'supplier.csv'),auth.uid(),jsonb_array_length(coalesce(p_rows,'[]'::jsonb))) returning id into v_batch;
  for v_row in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    if nullif(btrim(v_row->>'name'),'') is null then update public.club_supplier_import_batches set invalid_count=invalid_count+1 where id=v_batch; continue; end if;
    v_product := null;
    if nullif(btrim(v_row->>'supplierSku'),'') is not null then select id into v_product from public.club_supplier_products where organisation_id=p_organisation_id and supplier_id=v_supplier and supplier_sku=btrim(v_row->>'supplierSku') limit 1; end if;
    if v_product is null then insert into public.club_supplier_products(organisation_id,supplier_id,supplier_sku,barcode,brand,name,variant,size,description,category,wholesale_cost_minor,supplier_rrp_minor,supplier_availability,image_url,supplier_url,discontinued) values(p_organisation_id,v_supplier,nullif(btrim(v_row->>'supplierSku'),''),nullif(btrim(v_row->>'barcode'),''),nullif(btrim(v_row->>'brand'),''),btrim(v_row->>'name'),nullif(btrim(v_row->>'variant'),''),nullif(btrim(v_row->>'size'),''),nullif(v_row->>'description',''),nullif(btrim(v_row->>'category'),''),nullif(v_row->>'wholesaleCostMinor','')::integer,nullif(v_row->>'rrpMinor','')::integer,nullif(v_row->>'availability','')::integer,nullif(v_row->>'imageUrl',''),nullif(v_row->>'supplierUrl',''),coalesce((v_row->>'discontinued')::boolean,false)) returning id into v_product; v_created:=v_created+1;
    else update public.club_supplier_products set barcode=nullif(btrim(v_row->>'barcode'),''),brand=nullif(btrim(v_row->>'brand'),''),name=btrim(v_row->>'name'),variant=nullif(btrim(v_row->>'variant'),''),size=nullif(btrim(v_row->>'size'),''),description=nullif(v_row->>'description',''),category=nullif(btrim(v_row->>'category'),''),wholesale_cost_minor=nullif(v_row->>'wholesaleCostMinor','')::integer,supplier_rrp_minor=nullif(v_row->>'rrpMinor','')::integer,supplier_availability=nullif(v_row->>'availability','')::integer,image_url=nullif(v_row->>'imageUrl',''),supplier_url=nullif(v_row->>'supplierUrl',''),discontinued=coalesce((v_row->>'discontinued')::boolean,false),updated_at=now() where id=v_product; v_updated:=v_updated+1; end if;
  end loop;
  update public.club_supplier_import_batches set created_count=v_created,updated_count=v_updated where id=v_batch;
  return jsonb_build_object('batchId',v_batch,'created',v_created,'updated',v_updated);
end; $$;
revoke all on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) from public,anon;
grant execute on function public.club_import_supplier_catalogue(uuid,text,text,jsonb) to authenticated;

-- Extend the existing capability boundary for supplier commerce. This keeps
-- SECURITY DEFINER functions aligned with the same override/preset model.
create or replace function public.club_capability_allowed(p_organisation_id uuid,p_user_id uuid,p_capability text)
returns boolean language sql security definer set search_path=pg_catalog,public as $$
select (exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='allow') or exists(select 1 from public.club_members m where m.organisation_id=p_organisation_id and m.user_id=p_user_id and m.active and (
  (m.role='owner') or
  (m.role='gym_admin' and p_capability in ('members.view','members.create','members.link_account','memberships.assign','memberships.end_immediately','payments.take','payments.record_cash','refunds.issue','refunds.approve','cash.reconcile','inventory.adjust','induction.manage_policy','classes.manage','services.manage','supplier.catalogue_manage','supplier.orders_manage','supplier.receive','commerce.pricing_manage','commerce.collections_manage')) or
  (m.role='gym_staff' and p_capability in ('members.view','members.create','members.link_account','payments.take','payments.record_cash','cash.reconcile','supplier.receive','commerce.collections_manage')) or
  (m.role='trainer' and p_capability='members.view'))
)) and not exists(select 1 from public.club_staff_permission_overrides o where o.organisation_id=p_organisation_id and o.user_id=p_user_id and o.capability=p_capability and o.decision='deny');
$$;
revoke all on function public.club_capability_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.club_capability_allowed(uuid,uuid,text) to authenticated;
