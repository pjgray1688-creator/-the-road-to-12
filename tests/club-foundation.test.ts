import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canAccess, canAccessGym, canConsume, clubAcceptanceFixtures, consumeAllowance, isValidAt, periodKey, remainingAllowance, resolveEntitlements, type EntitlementGrant, type EntitlementUsage } from "../lib/club";
import { MemoryClubRepository, madhouseFixture } from "../lib/club-repository";
import { resolveOrganisationTheme } from "../lib/club";

const grant = (overrides: Partial<EntitlementGrant> = {}): EntitlementGrant => ({ id: "g", userId: "u", organisationId: "madhouse", entitlementKey: "class_access", scope: "organisation", validity: { startsAt: "2026-01-01T00:00:00Z" }, source: "purchase", allowance: { quantity: 4, period: "month" }, ...overrides });
test("validity windows and archived products do not revoke existing grants", () => { assert.equal(resolveEntitlements("u", [grant({ validity: { startsAt: "2026-01-01", endsAt: "2026-10-01" } })], "2026-09-01").length, 1); assert.equal(isValidAt({ startsAt: "2026-01-01", endsAt: "2026-02-01" }, "2026-09-01"), false); assert.equal(clubAcceptanceFixtures.goldenTicket.lifetime, true); });
test("organisation and location scopes are enforced", () => { const all = grant({ entitlementKey: "gym_access", scope: "future_locations" }); const selected = grant({ id: "s", entitlementKey: "gym_access", scope: "locations", locationIds: ["rotherham"] }); assert.equal(canAccessGym("u", "madhouse", "future", [all]), true); assert.equal(canAccessGym("u", "other", "future", [all]), false); assert.equal(canAccessGym("u", "madhouse", "rotherham", [selected]), true); assert.equal(canAccessGym("u", "madhouse", "carlton", [selected]), false); });
test("recurring allowance periods and idempotent usage shape are deterministic", () => { const at = "2026-09-02T12:00:00Z"; assert.equal(periodKey("month", at), "2026-09"); assert.equal(periodKey("week", at), "2026-08-31"); const g = grant(); const usage: EntitlementUsage[] = [consumeAllowance(g, 1, [], "class-1", at)]; assert.equal(remainingAllowance(g, usage, at), 3); assert.equal(canConsume(g, 3, usage, at), true); assert.equal(canConsume(g, 4, usage, at), false); });
test("manual and permanent benefits are entitlement grants, not billing assumptions", () => { const g = grant({ entitlementKey: "enhanced_training", allowance: undefined, source: "staff_assignment" }); assert.equal(canAccess("u", "enhanced_training", [g], "2026-09-02"), true); assert.equal(clubAcceptanceFixtures.dayPass.durationDays, 1); assert.equal(clubAcceptanceFixtures.bronze.ptPerWeek, 1); });
test("couples membership can grant two independent account holders", () => { const members = [grant({ id: "a", userId: "a", entitlementKey: "gym_access" }), grant({ id: "b", userId: "b", entitlementKey: "gym_access" })]; assert.equal(canAccess("a", "gym_access", members), true); assert.equal(canAccess("b", "gym_access", members), true); });
test("memory repository is idempotent and organisation scoped", async () => { const repository = new MemoryClubRepository(); const products = await repository.listProducts(madhouseFixture.id); assert.equal(products.length, 12); const { id: _id, ...productWithoutId } = products[0]; const created = await repository.createProduct({ ...productWithoutId, name: "Gym Day Pass" }); assert.equal(created.id, products[0].id); assert.equal((await repository.listProducts("other-org")).length, 0); });
test("manual assignment materialises product benefits for every holder", async () => { const repository = new MemoryClubRepository(); const product = (await repository.listProducts(madhouseFixture.id)).find(item => item.name === "Couples Membership")!; const result = await repository.assignProduct({ organisationId: madhouseFixture.id, productId: product.id, userId: "u1", holderUserIds: ["u1", "u2"], source: "founding", validity: { startsAt: "2026-01-01" } }); assert.equal(result.membership.holderUserIds.length, 2); assert.equal(result.grants.filter(item => item.entitlementKey === "gym_access").length, 2); });
test("organisation themes are constrained and inactive organisations fall back to R12", () => { const themed = resolveOrganisationTheme({ ...madhouseFixture, branding: { coBranding: "co_branded", primaryAccent: "#123456", secondaryAccent: "not-a-colour" } }); assert.equal(themed.primaryAccent, "#123456"); assert.equal(themed.secondaryAccent, "#c084fc"); assert.equal(resolveOrganisationTheme({ ...madhouseFixture, active: false }).coBranding, "r12"); assert.equal(themed.platform, "R12"); });

const clubMigration = readFileSync(new URL("../supabase/migrations/2026-09-03-club-foundation.sql", import.meta.url), "utf8");

test("Club member relationships and benefits are read-only to their subject", () => {
  for (const policy of ["club_members_self_select", "club_holders_self_select", "club_grants_self_select", "club_usage_self_select"]) {
    assert.match(clubMigration, new RegExp(`create policy ${policy}[^;]+for select`, "s"));
  }
  assert.doesNotMatch(clubMigration, /create policy club_(?:members|holders|grants|usage)_self\b[^;]*for all/is);
});

test("Club administration is organisation-scoped and trainers are not administrators", () => {
  assert.match(clubMigration, /create policy club_members_admin_update[^;]+using \(role <> 'owner' and public\.club_has_active_role\(organisation_id, array\['gym_admin'\]\)\)[^;]+with check \(role <> 'owner'/is);
  assert.match(clubMigration, /create policy club_usage_staff_insert[^;]+club_can_record_grant_usage\(grant_id, user_id, array\['gym_staff','gym_admin','owner'\]\)/is);
  assert.doesNotMatch(clubMigration, /array\[[^\]]*'trainer'[^\]]*\][^;]*(?:insert|update|delete)/is);
  assert.match(clubMigration, /security definer\s+set search_path = pg_catalog, public/is);
  assert.match(clubMigration, /revoke all on function public\.club_has_active_role\(uuid, text\[\]\) from public;/i);
});

test("Club owners are protected from gym-admin insertion, updates and deletion", () => {
  assert.match(clubMigration, /create policy club_members_admin_insert[^;]+with check \(role <> 'owner'[^;]+array\['gym_admin'\]/is);
  assert.match(clubMigration, /create policy club_members_admin_delete[^;]+using \(role <> 'owner'[^;]+array\['gym_admin'\]/is);
  for (const action of ["insert", "update", "delete"]) {
    assert.match(clubMigration, new RegExp(`create policy club_members_owner_${action}[^;]+array\\['owner'\\]`, "is"));
  }
});

test("Club holder and grant writes require an active target member in the organisation", () => {
  assert.match(clubMigration, /create policy club_holders_admin_insert[^;]+club_can_assign_membership_holder\(membership_id, user_id/is);
  assert.match(clubMigration, /create policy club_grants_admin_insert[^;]+club_can_assign_grant\(organisation_id, user_id/is);
  assert.match(clubMigration, /create policy club_grants_admin_update[^;]+club_can_assign_grant\(organisation_id, user_id/is);
});

test("Club bootstrap is explicitly restricted to a trusted server or service role", () => {
  assert.match(clubMigration, /first organisation and its first owner[^.]+trusted\s+-- server\/service-role bootstrap operation/is);
  assert.doesNotMatch(clubMigration, /create policy club_org[^;]+for insert/is);
});

test("Club foreign keys prevent cross-organisation and cross-user relationship mismatches", () => {
  assert.match(clubMigration, /foreign key \(product_id, organisation_id\) references public\.club_products\(id, organisation_id\)/i);
  assert.match(clubMigration, /foreign key \(membership_id, organisation_id\) references public\.club_memberships\(id, organisation_id\)/i);
  assert.match(clubMigration, /foreign key \(grant_id, user_id\) references public\.club_entitlement_grants\(id, user_id\) on delete cascade/i);
});
