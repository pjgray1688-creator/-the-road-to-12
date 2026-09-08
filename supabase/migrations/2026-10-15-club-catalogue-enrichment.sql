-- Verified catalogue metadata only. No price, supplier availability or inventory fields are stored here.
create table if not exists public.club_supplier_variant_enrichment (
 id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
 supplier_product_id uuid not null references public.club_supplier_products(id) on delete cascade,
 description text, nutrition jsonb, ingredients text, allergens text, storage_use text,
 parent_image_url text, variant_image_url text, source_url text, source_type text, verified_at timestamptz,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organisation_id,supplier_product_id)
);
alter table public.club_supplier_variant_enrichment enable row level security;
revoke all on public.club_supplier_variant_enrichment from anon,authenticated;
