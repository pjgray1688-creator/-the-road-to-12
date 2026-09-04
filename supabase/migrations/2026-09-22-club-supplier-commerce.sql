-- Supplier catalogue and order-to-collection domain. Review and execute in a controlled environment.
create table if not exists public.club_suppliers (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null, active boolean not null default true, ordering_config jsonb not null default '{}'::jsonb,
  delivery_config jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists club_suppliers_org_name_uq on public.club_suppliers(organisation_id, lower(name));
create table if not exists public.club_supplier_products (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade, supplier_sku text, barcode text, brand text,
  name text not null, variant text, size text, description text, category text, wholesale_cost_minor integer, supplied_vat_rate numeric,
  supplier_rrp_minor integer, supplier_availability integer, image_url text, supplier_url text, discontinued boolean not null default false,
  sellable boolean not null default false, fulfilment_type text not null default 'supplier_order_for_collection', retail_price_minor integer,
  source_metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint club_supplier_products_fulfilment_ck check (fulfilment_type in ('stocked_at_location','supplier_order_for_collection','dropship'))
);
create unique index if not exists club_supplier_products_sku_uq on public.club_supplier_products(organisation_id,supplier_id,supplier_sku) where supplier_sku is not null;
create unique index if not exists club_supplier_products_barcode_uq on public.club_supplier_products(organisation_id,barcode) where barcode is not null;
create table if not exists public.club_supplier_import_batches (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id) on delete cascade, file_name text not null, imported_by uuid not null,
  row_count integer not null default 0, created_count integer not null default 0, updated_count integer not null default 0,
  skipped_count integer not null default 0, invalid_count integer not null default 0, conflict_count integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.club_supplier_demand (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid not null references public.club_suppliers(id), supplier_product_id uuid not null references public.club_supplier_products(id),
  order_id uuid not null references public.club_orders(id), order_item_id uuid, user_id uuid, collection_location_id uuid,
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
