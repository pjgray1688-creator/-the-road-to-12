import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-06-club-authenticated-table-privileges.sql", import.meta.url), "utf8");
const foundation = readFileSync(new URL("../supabase/migrations/2026-09-03-club-foundation.sql", import.meta.url), "utf8");
const productEntitlements = readFileSync(new URL("../supabase/migrations/2026-09-04-club-product-entitlements.sql", import.meta.url), "utf8");
const rpcs = readFileSync(new URL("../supabase/migrations/2026-09-05-club-transactional-rpcs.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/club/internal/catalogue-bootstrap/route.ts", import.meta.url), "utf8");
const repository = readFileSync(new URL("../lib/supabase-club-repository.ts", import.meta.url), "utf8");
const executableMigration = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");

const allTables = ["club_organisations", "club_locations", "club_members", "club_products", "club_product_entitlements", "club_memberships", "club_membership_holders", "club_entitlement_grants", "club_entitlement_usage"];
const directlyReadTables = ["club_organisations", "club_locations", "club_members", "club_products", "club_product_entitlements"];

test("authenticated receives SELECT only for tables directly read by SupabaseClubRepository", () => {
  assert.match(migration, /revoke all privileges on table[\s\S]+from public, anon, authenticated;/i);
  assert.match(migration, /grant select on table[\s\S]+to authenticated;/i);
  for (const table of directlyReadTables) {
    assert.match(repository, new RegExp(`\\.from\\("${table}"\\)`, "i"));
    assert.match(migration, new RegExp(`grant select on table[\\s\\S]+public\\.${table}[\\s\\S]+to authenticated;`, "i"));
  }
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|all|truncate|references|trigger)/i);
});

test("public and anon receive no Club table grants and every Club table keeps RLS enabled", () => {
  assert.doesNotMatch(executableMigration, /grant[^;]+to\s+(?:public|anon)\b/i);
  for (const table of allTables) assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`, "i"));
});

test("membership and issued-benefit tables stay RPC-only under the current repository contract", () => {
  for (const table of ["club_memberships", "club_membership_holders", "club_entitlement_grants", "club_entitlement_usage"]) {
    assert.doesNotMatch(repository, new RegExp(`\\.from\\("${table}"\\)`, "i"));
    assert.doesNotMatch(migration, new RegExp(`grant select on table[\\s\\S]*public\\.${table}[\\s\\S]*to authenticated;`, "i"));
  }
  for (const rpc of ["club_create_product", "club_update_product", "club_assign_product"]) {
    assert.match(repository, new RegExp(`\\.rpc\\("${rpc}"`));
    assert.match(rpcs, new RegExp(`revoke all on function public\\.${rpc}\\([^;]+\\) from public;`, "i"));
    assert.match(rpcs, new RegExp(`grant execute on function public\\.${rpc}\\([^;]+\\) to authenticated;`, "i"));
  }
  assert.match(rpcs, /security definer[\s\S]+set search_path = pg_catalog, public/i);
});

test("installed Club RLS policy architecture remains intact", () => {
  for (const table of allTables.filter(table => table !== "club_product_entitlements")) assert.match(foundation, new RegExp(`alter table public\\.${table} enable row level security;`, "i"));
  assert.match(productEntitlements, /alter table public\.club_product_entitlements enable row level security;/i);
});

test("bootstrap catches owner lookup failures and returns a safe JSON 500", () => {
  const tryIndex = route.indexOf("try {"); const ownerLookupIndex = route.indexOf("repository.listMembers"); const catchIndex = route.indexOf("} catch (error)");
  assert.ok(tryIndex >= 0 && ownerLookupIndex > tryIndex && catchIndex > ownerLookupIndex);
  assert.match(route, /NextResponse\.json\(\{ error: "Catalogue bootstrap failed safely" \}, \{ status: 500 \}\)/);
  assert.doesNotMatch(route, /console\.error\([^;]+, error\)/);
});
