import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stageMemberCsv } from "../lib/club-member-import";
import { membershipProducts } from "../lib/club-membership-catalogue";

const root = process.cwd();
const page = readFileSync(`${root}/app/club/members/import/page.tsx`, "utf8");
const component = readFileSync(`${root}/components/club-member-import.tsx`, "utf8");
const action = readFileSync(`${root}/app/club/members/import/actions.ts`, "utf8");
const migration = readFileSync(`${root}/supabase/migrations/2026-11-18-club-historical-import-categories.sql`, "utf8");

test("the 21-column import retains all 702 rows and original source columns", () => {
  const headers = ["First Name", "Last Name", "Email", "Phone", "Membership", "Status", "Start Date", "Expiry Date", "Next Payment", "Home Gym", "Legacy ID", ...Array.from({ length: 10 }, (_, i) => `Original Evidence ${i + 1}`)];
  const csv = [headers.join(","), ...Array.from({ length: 702 }, (_, i) => [`Person${i + 1}`, "Example", `p${i + 1}@example.test`, "", "Former Monthly", "expired", "2019-01-01", "2020-01-01", "", "Carlton", `LEG-${i + 1}`, ...Array.from({ length: 10 }, (_, j) => `evidence-${i + 1}-${j + 1}`)].join(","))].join("\n");
  const preview = stageMemberCsv(csv);
  assert.equal(preview.headers.length, 21);
  assert.equal(preview.rows.length, 702);
  assert.equal(Object.keys(preview.rows[0].raw).length, 21);
  assert.equal(preview.rows[0].raw["original evidence 10"], "evidence-1-10");
});

test("historical categories are archived non-billing markers and current archived products remain mappable", () => {
  assert.match(page, /products\.filter\(product => product\.kind === "membership"\)/);
  assert.match(component, /historical only, no billing or access/);
  assert.match(component, /archived product, review historical\/current mapping/);
  for (const category of ["historical_membership", "historical_pass", "historical_classes_pass"]) assert.ok(migration.includes(category));
  assert.match(migration, /'membership',0,'GBP','manual',null,false,now\(\)/);
  assert.match(migration, /not exists\([\s\S]*club_product_entitlements/);
  assert.match(migration, /p\.legacy_import_category is null\)/);
  assert.match(migration, /club_map_member_import_package/);
});

test("historical rows preserve source evidence, become expired and household billing is held for review", () => {
  assert.match(migration, /new\.normalized_values:=jsonb_set\(new\.normalized_values,'\{membershipStatus\}','"expired"'/);
  assert.match(migration, /Historical household membership requires separate billing-free review/);
  assert.match(migration, /Current or unexpired membership cannot be mapped to a historical category/);
  assert.match(migration, /club_reject_active_historical_import_membership/);
  assert.match(migration, /club_reject_historical_import_entitlement/);
  assert.match(migration, /club_reject_historical_import_billing/);
  assert.doesNotMatch(migration, /create or replace function public\.club_execute_member_import_batch\(/);
  assert.doesNotMatch(migration, /create or replace function public\.club_revalidate_member_import_batch\(/);
});

test("current live products and household-aware importer code remain intact", () => {
  const familyImport = readFileSync(`${root}/supabase/migrations/2027-01-25-family-shared-memberships-and-billing.sql`, "utf8");
  assert.match(familyImport, /householdReference/);
  assert.match(familyImport, /responsiblePayerReference/);
  assert.match(familyImport, /club_membership_shared_contracts/);
  assert.match(migration, /p\.kind='membership'/);
  assert.match(familyImport, /create or replace function public\.club_execute_member_import_batch/);
});

test("import completion does not queue invitations, activation email or marketing", () => {
  assert.doesNotMatch(action, /club_queue_member_import_activations|nudgeNotificationWorker/);
  assert.match(component, /No account invitations, activation emails or marketing were sent or queued/);
});

test("historical products remain excluded from ordinary live membership assignment", () => {
  const live = { id: "live", organisationId: "org", name: "Standard Monthly", kind: "membership" as const, priceMinor: 3000, currency: "GBP", billing: "recurring" as const, sellable: true };
  const historical = { id: "historic", organisationId: "org", name: "Historical Membership", kind: "membership" as const, priceMinor: 0, currency: "GBP", billing: "manual" as const, sellable: false, archivedAt: "2026-11-18T00:00:00Z", legacyImportCategory: "historical_membership" as const };
  assert.deepEqual(membershipProducts([live, historical], true), [live]);
});
