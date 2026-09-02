-- R12 Club product entitlement definitions (manual review only; not executed by this change).
-- These rows describe benefits promised by products. User-specific issued benefits
-- remain in club_entitlement_grants and acquire validity/source during assignment.
create table public.club_product_entitlements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  organisation_id uuid not null,
  position integer not null check (position >= 0),
  entitlement_key text not null check (length(btrim(entitlement_key)) > 0),
  scope text not null check (scope in ('organisation', 'locations', 'future_locations')),
  location_ids uuid[],
  allowance_quantity integer,
  allowance_period text,
  discount_percent numeric,
  discount_period text,
  discount_max_uses integer,
  created_at timestamptz not null default now(),
  unique (product_id, position),
  foreign key (product_id, organisation_id)
    references public.club_products(id, organisation_id) on delete cascade,
  check (
    (allowance_quantity is null and allowance_period is null)
    or
    (allowance_quantity is not null and allowance_quantity > 0 and allowance_period is not null and allowance_period in ('week', 'month', 'block'))
  ),
  check (discount_percent is null or (discount_percent > 0 and discount_percent <= 100)),
  check (discount_period is null or discount_period = 'month'),
  check (discount_max_uses is null or discount_max_uses > 0),
  check (
    discount_percent is not null
    or (discount_period is null and discount_max_uses is null)
  )
);

create index club_product_entitlements_org_idx
  on public.club_product_entitlements(organisation_id);

alter table public.club_product_entitlements enable row level security;

create policy club_product_entitlements_member_select
  on public.club_product_entitlements for select to authenticated
  using (
    public.club_has_active_role(
      organisation_id,
      array['member','trainer','gym_staff','gym_admin','owner','guest']
    )
  );

create policy club_product_entitlements_admin_insert
  on public.club_product_entitlements for insert to authenticated
  with check (
    public.club_has_active_role(organisation_id, array['gym_admin','owner'])
  );

create policy club_product_entitlements_admin_update
  on public.club_product_entitlements for update to authenticated
  using (
    public.club_has_active_role(organisation_id, array['gym_admin','owner'])
  )
  with check (
    public.club_has_active_role(organisation_id, array['gym_admin','owner'])
  );

create policy club_product_entitlements_admin_delete
  on public.club_product_entitlements for delete to authenticated
  using (
    public.club_has_active_role(organisation_id, array['gym_admin','owner'])
  );
