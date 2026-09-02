import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryClubRepository, madhouseFixture } from "../lib/club-repository";

const sql = readFileSync(new URL("../supabase/migrations/2026-09-05-club-transactional-rpcs.sql", import.meta.url), "utf8");
const body = (name: string) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`, "i"))?.[0] ?? "";

test("Club aggregate RPCs are locked-down authenticated security-definer functions", () => {
  for (const name of ["club_create_product", "club_update_product", "club_assign_product"]) {
    const functionSql = body(name);
    assert.match(functionSql, /security definer\s+set search_path = pg_catalog, public/i);
    assert.match(functionSql, /auth\.uid\(\) is null[\s\S]+club_has_active_role\([^;]+array\['gym_admin','owner'\]/i);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^;]+\\) from public;`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]+\\) to authenticated;`, "i"));
  }
});

test("product creation writes the product and ordered definitions in one RPC", () => {
  const functionSql = body("club_create_product");
  assert.match(functionSql, /insert into public\.club_products[\s\S]+returning \* into v_product/i);
  assert.match(functionSql, /insert into public\.club_product_entitlements[\s\S]+jsonb_array_elements\(p_entitlements\) with ordinality/i);
  assert.match(functionSql, /\(definition\.ordinality - 1\)::integer/i);
  assert.match(functionSql, /jsonb_build_object\('product',[\s\S]+'entitlements'/i);
});

test("product update locks identity and atomically replaces stale definitions without touching grants", () => {
  const functionSql = body("club_update_product");
  assert.match(functionSql, /where id = p_product_id\s+for update/i);
  assert.doesNotMatch(functionSql, /set[^;]*organisation_id\s*=/i);
  assert.match(functionSql, /update public\.club_products[\s\S]+delete from public\.club_product_entitlements[\s\S]+insert into public\.club_product_entitlements/i);
  assert.doesNotMatch(functionSql, /(?:update|delete from) public\.club_entitlement_grants/i);
});

test("assignment uses persisted definitions for one atomic membership-holder-grant aggregate", () => {
  const functionSql = body("club_assign_product");
  assert.doesNotMatch(functionSql, /p_entitlements|p_grants/i);
  assert.match(functionSql, /where id = p_product_id and organisation_id = p_organisation_id/i);
  assert.match(functionSql, /insert into public\.club_memberships[\s\S]+insert into public\.club_membership_holders[\s\S]+insert into public\.club_entitlement_grants/i);
  assert.match(functionSql, /cross join public\.club_product_entitlements definition/i);
  assert.match(functionSql, /definition\.scope[\s\S]+definition\.location_ids[\s\S]+definition\.allowance_quantity[\s\S]+definition\.discount_percent/i);
  assert.match(functionSql, /v_membership\.starts_at[\s\S]+v_membership\.ends_at[\s\S]+v_membership\.source/i);
});

test("aggregate functions rely on PostgreSQL rollback rather than partial-write handlers", () => {
  for (const name of ["club_create_product", "club_update_product", "club_assign_product"]) {
    const functionSql = body(name);
    assert.doesNotMatch(functionSql, /\bcommit\b|\brollback\b|exception\s+when/i);
  }
  assert.match(sql, /any raised error rolls back every[\s\S]+write made by that RPC call/i);
});

test("assignment normalizes duplicate holders and validates active same-organisation membership", () => {
  const functionSql = body("club_assign_product");
  assert.match(functionSql, /select distinct unnest\(p_holder_user_ids\)/i);
  assert.match(functionSql, /member\.organisation_id = v_product\.organisation_id[\s\S]+member\.user_id = any\(v_holder_user_ids\)[\s\S]+member\.active/i);
  assert.match(functionSql, /<> cardinality\(v_holder_user_ids\)/i);
  assert.match(functionSql, /from unnest\(v_holder_user_ids\)[\s\S]+cross join public\.club_product_entitlements/i);
});

test("assignment supports open and fixed validity, known sources, archived rejection and a locked definition snapshot", () => {
  const functionSql = body("club_assign_product");
  assert.match(functionSql, /p_ends_at is not null and p_ends_at <= p_starts_at/i);
  assert.doesNotMatch(functionSql, /p_ends_at is null[^;]+raise/i);
  assert.match(functionSql, /p_source not in \('purchase','subscription','staff_assignment','promotion','migration','founding'\)/i);
  assert.match(functionSql, /v_product\.archived_at is not null[\s\S]+cannot be newly assigned/i);
  assert.match(functionSql, /from public\.club_products[\s\S]+for share/i);
  assert.match(functionSql, /lock table public\.club_product_entitlements in share mode/i);
});

test("current Golden Ticket and Transformation definitions remain materialisable per holder", async () => {
  const repository = new MemoryClubRepository();
  const products = await repository.listProducts(madhouseFixture.id, true);
  const golden = products.find(product => product.name === "Golden Ticket Founding Membership")!;
  const transformation = products.find(product => product.name === "Transformation Gold")!;
  assert.ok(golden.entitlements?.some(item => item.scope === "future_locations"));
  assert.ok(golden.entitlements?.some(item => item.discount?.period === "month" && item.discount.maxUses === 1));
  assert.ok(transformation.entitlements?.some(item => item.entitlementKey === "enhanced_training"));
  assert.ok(transformation.entitlements?.some(item => item.allowance?.period === "week"));
  const assignment = await repository.assignProduct({ organisationId: madhouseFixture.id, productId: golden.id, userId: "one", holderUserIds: ["one", "two"], source: "founding", validity: { startsAt: "2026-01-01" } });
  assert.equal(assignment.grants.filter(grant => grant.userId === "one").length, golden.entitlements?.length);
  assert.equal(assignment.grants.filter(grant => grant.userId === "two").length, golden.entitlements?.length);
});

test("transactional RPC migration leaves existing Club RLS migrations untouched conceptually", () => {
  assert.doesNotMatch(sql, /alter table[^;]+(?:disable row level security|no force row level security)/i);
  assert.doesNotMatch(sql, /create policy|drop policy/i);
  assert.match(sql, /Repeated calls intentionally create distinct assignments; payment idempotency is future work/i);
});
