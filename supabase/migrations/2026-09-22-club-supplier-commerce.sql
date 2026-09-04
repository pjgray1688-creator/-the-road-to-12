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

create or replace function public.club_create_supplier_demand_for_order(p_order_id uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order record; v_item record; v_offer record; v_count integer:=0;
begin
  select o.* into v_order from public.club_orders o where o.id=p_order_id and o.status in ('paid','fulfilled');
  if not found then return 0; end if;
  for v_item in select i.* from public.club_order_items i where i.order_id=p_order_id loop
    select count(*) as count into v_count from public.club_supplier_products sp where sp.organisation_id=v_order.organisation_id and sp.club_product_id=v_item.product_id and sp.sellable and not sp.discontinued and sp.fulfilment_type='supplier_order_for_collection';
    if v_count <> 1 then continue; end if;
    select sp.* into v_offer from public.club_supplier_products sp where sp.organisation_id=v_order.organisation_id and sp.club_product_id=v_item.product_id and sp.sellable and not sp.discontinued and sp.fulfilment_type='supplier_order_for_collection' limit 1;
    insert into public.club_supplier_demand(organisation_id,supplier_id,supplier_product_id,order_id,order_item_id,user_id,collection_location_id,quantity_required)
    values(v_order.organisation_id,v_offer.supplier_id,v_offer.id,v_order.id,v_item.id,v_order.user_id,v_order.location_id,v_item.quantity)
    on conflict (order_item_id) do nothing;
  end loop;
  return 1;
end; $$;
revoke all on function public.club_create_supplier_demand_for_order(uuid) from public,anon;
grant execute on function public.club_create_supplier_demand_for_order(uuid) to authenticated;
create or replace function public.club_after_payment_supplier_demand() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin if new.status='paid' then perform public.club_create_supplier_demand_for_order(new.order_id); end if; return new; end; $$;
drop trigger if exists club_payments_supplier_demand on public.club_payments;
create trigger club_payments_supplier_demand after insert or update of status on public.club_payments for each row execute function public.club_after_payment_supplier_demand();

create or replace function public.club_list_supplier_demand(p_organisation_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'supplier',s.name,'supplier_sku',sp.supplier_sku,'barcode',sp.barcode,'product',coalesce(cp.name,sp.name),'brand',coalesce(cp.brand,sp.brand),'variant',sp.variant,'quantity_required',d.quantity_required,'quantity_received',d.quantity_received,'quantity_allocated',d.quantity_allocated,'status',d.status,'order_reference',left(d.order_id::text,8),'collection_location',l.name) order by s.name,sp.name), '[]'::jsonb)
from public.club_supplier_demand d join public.club_suppliers s on s.id=d.supplier_id join public.club_supplier_products sp on sp.id=d.supplier_product_id left join public.club_commerce_products cp on cp.id=sp.club_product_id left join public.club_locations l on l.id=d.collection_location_id
where d.organisation_id=p_organisation_id and public.club_capability_allowed(p_organisation_id,auth.uid(),'supplier.orders_manage');
$$;
revoke all on function public.club_list_supplier_demand(uuid) from public,anon;
grant execute on function public.club_list_supplier_demand(uuid) to authenticated;
