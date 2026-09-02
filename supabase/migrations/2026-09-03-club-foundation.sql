-- R12 Club foundation (manual review only; not executed by this change).
-- Creating the first organisation and its first owner is intentionally a trusted
-- server/service-role bootstrap operation. There is no authenticated INSERT
-- policy on club_organisations and ownership cannot be bootstrapped from a client.
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
  duration_days integer, sellable boolean not null default true, archived_at timestamptz, created_at timestamptz not null default now(),
  unique (id, organisation_id)
);
create table if not exists public.club_memberships (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.club_organisations(id) on delete cascade,
  product_id uuid not null, billing_group_id uuid, status text not null, starts_at timestamptz not null,
  ends_at timestamptz, source text not null, created_at timestamptz not null default now(), unique (id, organisation_id),
  foreign key (product_id, organisation_id) references public.club_products(id, organisation_id)
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
  ends_at timestamptz, source text not null, created_at timestamptz not null default now(), unique (id, user_id),
  foreign key (membership_id, organisation_id) references public.club_memberships(id, organisation_id)
);
create table if not exists public.club_entitlement_usage (
  id uuid primary key default gen_random_uuid(), grant_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade, period_key text not null, quantity integer not null check (quantity > 0),
  reference text, created_at timestamptz not null default now(), unique (grant_id, period_key, reference),
  foreign key (grant_id, user_id) references public.club_entitlement_grants(id, user_id) on delete cascade
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

-- Keep role checks out of club_members policies themselves. These helpers run as
-- their owner so policy evaluation cannot recurse through club_members RLS.
create or replace function public.club_has_active_role(target_organisation_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.club_members
    where organisation_id = target_organisation_id
      and user_id = auth.uid()
      and active
      and role = any (allowed_roles)
  );
$$;

create or replace function public.club_is_membership_holder(target_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.club_membership_holders
    where membership_id = target_membership_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.club_has_membership_role(target_membership_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.club_memberships membership
    join public.club_members member
      on member.organisation_id = membership.organisation_id
    where membership.id = target_membership_id
      and member.user_id = auth.uid()
      and member.active
      and member.role = any (allowed_roles)
  );
$$;

create or replace function public.club_can_assign_membership_holder(target_membership_id uuid, target_user_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.club_memberships membership
    join public.club_members actor
      on actor.organisation_id = membership.organisation_id
    join public.club_members target
      on target.organisation_id = membership.organisation_id
     and target.user_id = target_user_id
     and target.active
    where membership.id = target_membership_id
      and actor.user_id = auth.uid()
      and actor.active
      and actor.role = any (allowed_roles)
  );
$$;

create or replace function public.club_can_assign_grant(target_organisation_id uuid, target_user_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.club_members actor
    join public.club_members target
      on target.organisation_id = actor.organisation_id
     and target.user_id = target_user_id
     and target.active
    where actor.organisation_id = target_organisation_id
      and actor.user_id = auth.uid()
      and actor.active
      and actor.role = any (allowed_roles)
  );
$$;

create or replace function public.club_has_grant_role(target_grant_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.club_entitlement_grants grant_record
    join public.club_members member
      on member.organisation_id = grant_record.organisation_id
    where grant_record.id = target_grant_id
      and member.user_id = auth.uid()
      and member.active
      and member.role = any (allowed_roles)
  );
$$;

create or replace function public.club_can_record_grant_usage(target_grant_id uuid, target_user_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.club_entitlement_grants grant_record
    join public.club_members member
      on member.organisation_id = grant_record.organisation_id
    where grant_record.id = target_grant_id
      and grant_record.user_id = target_user_id
      and member.user_id = auth.uid()
      and member.active
      and member.role = any (allowed_roles)
  );
$$;

revoke all on function public.club_has_active_role(uuid, text[]) from public;
revoke all on function public.club_is_membership_holder(uuid) from public;
revoke all on function public.club_has_membership_role(uuid, text[]) from public;
revoke all on function public.club_can_assign_membership_holder(uuid, uuid, text[]) from public;
revoke all on function public.club_can_assign_grant(uuid, uuid, text[]) from public;
revoke all on function public.club_has_grant_role(uuid, text[]) from public;
revoke all on function public.club_can_record_grant_usage(uuid, uuid, text[]) from public;
grant execute on function public.club_has_active_role(uuid, text[]) to authenticated;
grant execute on function public.club_is_membership_holder(uuid) to authenticated;
grant execute on function public.club_has_membership_role(uuid, text[]) to authenticated;
grant execute on function public.club_can_assign_membership_holder(uuid, uuid, text[]) to authenticated;
grant execute on function public.club_can_assign_grant(uuid, uuid, text[]) to authenticated;
grant execute on function public.club_has_grant_role(uuid, text[]) to authenticated;
grant execute on function public.club_can_record_grant_usage(uuid, uuid, text[]) to authenticated;

create policy club_org_member_select on public.club_organisations for select to authenticated
  using (public.club_has_active_role(id, array['member','trainer','gym_staff','gym_admin','owner','guest']));
create policy club_org_admin_update on public.club_organisations for update to authenticated
  using (public.club_has_active_role(id, array['gym_admin','owner']))
  with check (public.club_has_active_role(id, array['gym_admin','owner']));
create policy club_org_owner_delete on public.club_organisations for delete to authenticated
  using (public.club_has_active_role(id, array['owner']));

create policy club_locations_member_select on public.club_locations for select to authenticated
  using (public.club_has_active_role(organisation_id, array['member','trainer','gym_staff','gym_admin','owner','guest']));
create policy club_locations_admin_insert on public.club_locations for insert to authenticated
  with check (public.club_has_active_role(organisation_id, array['gym_admin','owner']));
create policy club_locations_admin_update on public.club_locations for update to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']))
  with check (public.club_has_active_role(organisation_id, array['gym_admin','owner']));
create policy club_locations_admin_delete on public.club_locations for delete to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']));

create policy club_members_self_select on public.club_members for select to authenticated
  using (user_id = auth.uid());
create policy club_members_staff_select on public.club_members for select to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_staff','gym_admin','owner']));
create policy club_members_owner_insert on public.club_members for insert to authenticated
  with check (public.club_has_active_role(organisation_id, array['owner']));
create policy club_members_admin_insert on public.club_members for insert to authenticated
  with check (role <> 'owner' and public.club_has_active_role(organisation_id, array['gym_admin']));
create policy club_members_owner_update on public.club_members for update to authenticated
  using (public.club_has_active_role(organisation_id, array['owner']))
  with check (public.club_has_active_role(organisation_id, array['owner']));
create policy club_members_admin_update on public.club_members for update to authenticated
  using (role <> 'owner' and public.club_has_active_role(organisation_id, array['gym_admin']))
  with check (role <> 'owner' and public.club_has_active_role(organisation_id, array['gym_admin']));
create policy club_members_owner_delete on public.club_members for delete to authenticated
  using (public.club_has_active_role(organisation_id, array['owner']));
create policy club_members_admin_delete on public.club_members for delete to authenticated
  using (role <> 'owner' and public.club_has_active_role(organisation_id, array['gym_admin']));

create policy club_products_member_select on public.club_products for select to authenticated
  using (public.club_has_active_role(organisation_id, array['member','trainer','gym_staff','gym_admin','owner','guest']));
create policy club_products_admin_insert on public.club_products for insert to authenticated
  with check (public.club_has_active_role(organisation_id, array['gym_admin','owner']));
create policy club_products_admin_update on public.club_products for update to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']))
  with check (public.club_has_active_role(organisation_id, array['gym_admin','owner']));
create policy club_products_admin_delete on public.club_products for delete to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']));

create policy club_memberships_holder_select on public.club_memberships for select to authenticated
  using (public.club_is_membership_holder(id));
create policy club_memberships_staff_select on public.club_memberships for select to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_staff','gym_admin','owner']));
create policy club_memberships_admin_insert on public.club_memberships for insert to authenticated
  with check (public.club_has_active_role(organisation_id, array['gym_admin','owner']));
create policy club_memberships_admin_update on public.club_memberships for update to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']))
  with check (public.club_has_active_role(organisation_id, array['gym_admin','owner']));
create policy club_memberships_admin_delete on public.club_memberships for delete to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']));

create policy club_holders_self_select on public.club_membership_holders for select to authenticated
  using (user_id = auth.uid());
create policy club_holders_staff_select on public.club_membership_holders for select to authenticated
  using (public.club_has_membership_role(membership_id, array['gym_staff','gym_admin','owner']));
create policy club_holders_admin_insert on public.club_membership_holders for insert to authenticated
  with check (public.club_can_assign_membership_holder(membership_id, user_id, array['gym_admin','owner']));
create policy club_holders_admin_delete on public.club_membership_holders for delete to authenticated
  using (public.club_has_membership_role(membership_id, array['gym_admin','owner']));

create policy club_grants_self_select on public.club_entitlement_grants for select to authenticated
  using (user_id = auth.uid());
create policy club_grants_staff_select on public.club_entitlement_grants for select to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_staff','gym_admin','owner']));
create policy club_grants_admin_insert on public.club_entitlement_grants for insert to authenticated
  with check (public.club_can_assign_grant(organisation_id, user_id, array['gym_admin','owner']));
create policy club_grants_admin_update on public.club_entitlement_grants for update to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']))
  with check (public.club_can_assign_grant(organisation_id, user_id, array['gym_admin','owner']));
create policy club_grants_admin_delete on public.club_entitlement_grants for delete to authenticated
  using (public.club_has_active_role(organisation_id, array['gym_admin','owner']));

create policy club_usage_self_select on public.club_entitlement_usage for select to authenticated
  using (user_id = auth.uid());
create policy club_usage_staff_select on public.club_entitlement_usage for select to authenticated
  using (public.club_has_grant_role(grant_id, array['gym_staff','gym_admin','owner']));
create policy club_usage_staff_insert on public.club_entitlement_usage for insert to authenticated
  with check (public.club_can_record_grant_usage(grant_id, user_id, array['gym_staff','gym_admin','owner']));
create policy club_usage_admin_update on public.club_entitlement_usage for update to authenticated
  using (public.club_has_grant_role(grant_id, array['gym_admin','owner']))
  with check (public.club_can_record_grant_usage(grant_id, user_id, array['gym_admin','owner']));
create policy club_usage_admin_delete on public.club_entitlement_usage for delete to authenticated
  using (public.club_has_grant_role(grant_id, array['gym_admin','owner']));
