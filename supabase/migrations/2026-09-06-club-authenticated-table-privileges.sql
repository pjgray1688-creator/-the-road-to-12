-- R12 Club authenticated table privileges (forward-only; prepare, do not execute here).
-- RLS policies constrain rows but do not grant the underlying table privilege.
-- The current authenticated repository reads only these five tables. Aggregate
-- product and assignment mutations remain exclusively behind the hardened RPCs.

revoke all privileges on table
  public.club_organisations,
  public.club_locations,
  public.club_members,
  public.club_products,
  public.club_product_entitlements,
  public.club_memberships,
  public.club_membership_holders,
  public.club_entitlement_grants,
  public.club_entitlement_usage
from public, anon, authenticated;

grant select on table
  public.club_organisations,
  public.club_locations,
  public.club_members,
  public.club_products,
  public.club_product_entitlements
to authenticated;

-- Keep row-level enforcement explicit for every Club table. No table privilege is
-- granted to public/anon, and authenticated receives no direct mutation privilege.
alter table public.club_organisations enable row level security;
alter table public.club_locations enable row level security;
alter table public.club_members enable row level security;
alter table public.club_products enable row level security;
alter table public.club_product_entitlements enable row level security;
alter table public.club_memberships enable row level security;
alter table public.club_membership_holders enable row level security;
alter table public.club_entitlement_grants enable row level security;
alter table public.club_entitlement_usage enable row level security;
