-- R12 Club foundation (manual review only; not executed by this change).
create table if not exists public.club_organisations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.club_locations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  name text not null, active boolean not null default true, created_at timestamptz not null default now(), unique (organisation_id, name)
);
create table if not exists public.club_members (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role text not null check (role in ('member','trainer','gym_staff','gym_admin','owner','guest')),
  active boolean not null default true, created_at timestamptz not null default now(), unique (organisation_id, user_id)
);
create table if not exists public.club_products (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  name text not null, kind text not null, price_minor integer not null default 0, currency text not null default 'GBP', billing text not null,
  duration_days integer, sellable boolean not null default true, archived_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.club_memberships (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  product_id uuid not null references public.club_products(id), billing_group_id uuid, status text not null, starts_at timestamptz not null,
  ends_at timestamptz, source text not null, created_at timestamptz not null default now()
);
create table if not exists public.club_membership_holders (
  membership_id uuid not null references public.club_memberships(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  primary key (membership_id, user_id)
);
create table if not exists public.club_entitlement_grants (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.club_organisations(id) on delete cascade, membership_id uuid references public.club_memberships(id) on delete set null,
  entitlement_key text not null, scope text not null, location_ids uuid[] not null default '{}', allowance_quantity integer,
  allowance_period text, discount_percent numeric, discount_period text, discount_max_uses integer, starts_at timestamptz not null,
  ends_at timestamptz, source text not null, created_at timestamptz not null default now(), unique (user_id, id)
);
create table if not exists public.club_entitlement_usage (
  id uuid primary key default gen_random_uuid(), grant_id uuid not null references public.club_entitlement_grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, period_key text not null, quantity integer not null check (quantity > 0),
  reference text, created_at timestamptz not null default now(), unique (grant_id, period_key, reference)
);
create index if not exists club_members_org_idx on public.club_members(organisation_id);
create index if not exists club_grants_user_validity_idx on public.club_entitlement_grants(user_id, starts_at, ends_at);
create index if not exists club_usage_grant_period_idx on public.club_entitlement_usage(grant_id, period_key);
alter table public.club_organisations enable row level security;
alter table public.club_locations enable row level security;
alter table public.club_members enable row level security;
alter table public.club_products enable row level security;
alter table public.club_memberships enable row level security;
alter table public.club_membership_holders enable row level security;
alter table public.club_entitlement_grants enable row level security;
alter table public.club_entitlement_usage enable row level security;
create policy club_members_self on public.club_members for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy club_holders_self on public.club_membership_holders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy club_grants_self on public.club_entitlement_grants for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy club_usage_self on public.club_entitlement_usage for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy club_locations_member_read on public.club_locations for select using (exists (select 1 from public.club_members m where m.organisation_id = club_locations.organisation_id and m.user_id = auth.uid() and m.active));
create policy club_products_member_read on public.club_products for select using (exists (select 1 from public.club_members m where m.organisation_id = club_products.organisation_id and m.user_id = auth.uid() and m.active));
create policy club_org_member_read on public.club_organisations for select using (exists (select 1 from public.club_members m where m.organisation_id = club_organisations.id and m.user_id = auth.uid() and m.active));
