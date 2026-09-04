-- Configurable supplier ordering cycles and location replenishment settings.
alter table public.club_suppliers add column if not exists timezone text not null default 'Europe/London';
alter table public.club_suppliers add column if not exists ordering_active boolean not null default true;
alter table public.club_suppliers add column if not exists cutoff_weekday smallint;
alter table public.club_suppliers add column if not exists cutoff_local_time time;
alter table public.club_suppliers add column if not exists order_weekday smallint;
alter table public.club_suppliers add column if not exists delivery_start_weekday smallint;
alter table public.club_suppliers add column if not exists delivery_end_weekday smallint;
alter table public.club_suppliers add constraint club_suppliers_weekdays_ck check (cutoff_weekday is null or cutoff_weekday between 0 and 6) not valid;
alter table public.club_suppliers add constraint club_suppliers_order_weekday_ck check (order_weekday is null or order_weekday between 0 and 6) not valid;
create table if not exists public.club_supplier_replenishment_rules (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
 location_id uuid not null, product_id uuid not null, supplier_product_id uuid not null references public.club_supplier_products(id) on delete restrict,
 minimum_quantity integer not null check (minimum_quantity >= 0), target_quantity integer not null check (target_quantity >= minimum_quantity), enabled boolean not null default true,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (organisation_id, location_id, product_id), foreign key (location_id, organisation_id) references public.club_locations(id, organisation_id), foreign key (product_id, organisation_id) references public.club_commerce_products(id, organisation_id)
);
alter table public.club_supplier_replenishment_rules enable row level security;
revoke all on public.club_supplier_replenishment_rules from anon,authenticated;
