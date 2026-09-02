import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ClubRepository } from "../lib/club-repository";
import { MemoryClubRepository, madhouseFixture } from "../lib/club-repository";
import type { ClubProduct } from "../lib/club";
import { catalogueBootstrapEnabled, catalogueProductMatches, MADHOUSE_PRODUCTION_ORGANISATION_ID, madhouseCatalogue, materialiseCatalogueProduct, reconcileMadhouseCatalogue } from "../lib/madhouse-catalogue";

const byName = (name: string) => madhouseCatalogue.find(product => product.name === name)!;
const entitlement = (product: (typeof madhouseCatalogue)[number], key: string) => product.entitlements.find(item => item.entitlementKey === key);

test("Madhouse catalogue is the exact typed twelve-product source of truth", () => {
  assert.equal(madhouseCatalogue.length, 12);
  assert.deepEqual(Object.fromEntries(madhouseCatalogue.map(product => [product.name, product.priceMinor])), {
    "Gym Day Pass": 500, "Week Pass": 1200, "Concession Monthly": 2200, "Standard Monthly": 2700,
    "Couples Membership": 4500, "Yearly Membership": 25000, "Transformation Bronze": 25000,
    "Transformation Silver": 40000, "Transformation Gold": 52500, "Single PT Session": 3000,
    "10 PT Session Block": 20000, "Golden Ticket Founding Membership": 50000,
  });
  assert.ok(madhouseCatalogue.every(product => product.currency === "GBP"));
  assert.deepEqual([byName("Gym Day Pass").durationDays, byName("Week Pass").durationDays], [1, 7]);
  assert.ok(["Bronze", "Silver", "Gold"].every(level => byName(`Transformation ${level}`).kind === "transformation" && byName(`Transformation ${level}`).billing === "one_off" && byName(`Transformation ${level}`).durationDays === 70));
});

test("membership, transformation and PT catalogue benefits retain exact semantics", () => {
  assert.deepEqual(entitlement(byName("Standard Monthly"), "class_access")?.allowance, { quantity: 4, period: "month" });
  assert.deepEqual(entitlement(byName("Yearly Membership"), "class_access")?.allowance, { quantity: 1, period: "week" });
  for (const [level, credits] of [["Bronze", 1], ["Silver", 2], ["Gold", 3]] as const) {
    const product = byName(`Transformation ${level}`); assert.deepEqual(entitlement(product, "pt_session_credit")?.allowance, { quantity: credits, period: "week" });
    for (const feature of ["enhanced_training", "nutrition", "trainer_managed"]) assert.equal(entitlement(product, feature)?.scope, "organisation");
  }
  assert.ok(madhouseCatalogue.filter(product => product.entitlements.some(item => item.entitlementKey === "gym_access")).every(product => entitlement(product, "gym_access")?.scope === "future_locations"));
  assert.deepEqual(entitlement(byName("Single PT Session"), "pt_session_credit")?.allowance, { quantity: 1, period: "block" });
  assert.deepEqual(entitlement(byName("10 PT Session Block"), "pt_session_credit")?.allowance, { quantity: 10, period: "block" });
});

test("Golden Ticket and Couples definitions remain assignment-ready without assigning holders", () => {
  const golden = byName("Golden Ticket Founding Membership"); assert.equal(golden.sellable, false); assert.equal(golden.durationDays, undefined); assert.equal(entitlement(golden, "gym_access")?.scope, "future_locations"); assert.deepEqual(entitlement(golden, "discount")?.discount, { percent: 20, period: "month", maxUses: 1 });
  assert.equal(madhouseCatalogue.filter(product => product !== golden).every(product => product.sellable), true);
  const couples = byName("Couples Membership"); assert.equal(couples.kind, "membership"); assert.equal(couples.billing, "recurring"); assert.equal(entitlement(couples, "gym_access")?.scope, "future_locations");
});

class CatalogueRepository implements ClubRepository {
  creates: Array<Omit<ClubProduct, "id">> = []; updates = 0; assignments = 0;
  constructor(public products: ClubProduct[] = [], private readonly rejectCreates = false) {}
  async listOrganisations() { return []; } async listLocations() { return []; } async listMembers() { return []; }
  async listProducts() { return this.products; }
  async createProduct(product: Omit<ClubProduct, "id">) { if (this.rejectCreates) throw new Error("forbidden"); this.creates.push(product); const created = { ...product, id: `db-${this.creates.length}` }; this.products.push(created); return created; }
  updateProduct(_id: string, _patch: Partial<ClubProduct>): ReturnType<ClubRepository["updateProduct"]> { this.updates += 1; return Promise.reject(new Error("not_expected")); }
  assignProduct(_input: Parameters<ClubRepository["assignProduct"]>[0]): ReturnType<ClubRepository["assignProduct"]> { this.assignments += 1; return Promise.reject(new Error("not_expected")); }
}

test("catalogue reconciliation creates missing products through the repository and never assigns", async () => {
  const repository = new CatalogueRepository(); const results = await reconcileMadhouseCatalogue(repository);
  assert.equal(results.filter(result => result.status === "created").length, 12); assert.equal(repository.creates.length, 12); assert.equal(repository.updates, 0); assert.equal(repository.assignments, 0);
  assert.ok(repository.creates.every(product => product.organisationId === MADHOUSE_PRODUCTION_ORGANISATION_ID));
});

test("matching catalogue products are not duplicated and semantic entitlement order is ignored", async () => {
  const matching = madhouseCatalogue.map((definition, index) => { const product = materialiseCatalogueProduct(definition, MADHOUSE_PRODUCTION_ORGANISATION_ID, `existing-${index}`); product.entitlements = [...(product.entitlements ?? [])].reverse(); return product; });
  assert.equal(catalogueProductMatches(matching[3], byName("Standard Monthly")), true);
  const repository = new CatalogueRepository(matching); const results = await reconcileMadhouseCatalogue(repository);
  assert.equal(results.every(result => result.status === "already_matching"), true); assert.equal(repository.creates.length, 0);
});

test("catalogue drift and duplicate exact names are reported without overwrite", async () => {
  const drifted = materialiseCatalogueProduct(byName("Gym Day Pass"), MADHOUSE_PRODUCTION_ORGANISATION_ID, "existing"); drifted.priceMinor = 999;
  const duplicate = materialiseCatalogueProduct(byName("Week Pass"), MADHOUSE_PRODUCTION_ORGANISATION_ID, "duplicate-a");
  const repository = new CatalogueRepository([drifted, duplicate, { ...duplicate, id: "duplicate-b" }]); const results = await reconcileMadhouseCatalogue(repository);
  assert.deepEqual(results.find(result => result.name === "Gym Day Pass"), { name: "Gym Day Pass", status: "drift_detected", detail: "catalogue_difference" });
  assert.deepEqual(results.find(result => result.name === "Week Pass"), { name: "Week Pass", status: "drift_detected", detail: "duplicate_exact_name" }); assert.equal(repository.updates, 0);
});

test("a sellable production Golden Ticket is drift while every other catalogue product still matches", async () => {
  const existing = madhouseCatalogue.map((definition, index) => materialiseCatalogueProduct(definition, MADHOUSE_PRODUCTION_ORGANISATION_ID, `existing-${index}`));
  existing.find(product => product.name === "Golden Ticket Founding Membership")!.sellable = true;
  const repository = new CatalogueRepository(existing); const results = await reconcileMadhouseCatalogue(repository);
  assert.deepEqual(results.find(result => result.name === "Golden Ticket Founding Membership"), { name: "Golden Ticket Founding Membership", status: "drift_detected", detail: "catalogue_difference" });
  assert.equal(results.filter(result => result.name !== "Golden Ticket Founding Membership").every(result => result.status === "already_matching"), true);
  assert.equal(repository.creates.length, 0); assert.equal(repository.updates, 0); assert.equal(repository.assignments, 0);
});

test("create authorization failures are reported safely and do not fall back to assignments", async () => {
  const repository = new CatalogueRepository([], true); const results = await reconcileMadhouseCatalogue(repository);
  assert.equal(results.every(result => result.status === "failed" && result.detail === "create_failed"), true); assert.equal(repository.assignments, 0);
});

test("MemoryClubRepository materialises the shared catalogue definitions", async () => {
  const products = await new MemoryClubRepository().listProducts(madhouseFixture.id, true); assert.equal(products.length, madhouseCatalogue.length);
  for (const definition of madhouseCatalogue) assert.equal(catalogueProductMatches(products.find(product => product.name === definition.name)!, definition), true);
});

test("bootstrap is disabled by default and route retains layered owner authentication", () => {
  assert.equal(catalogueBootstrapEnabled(undefined), false); assert.equal(catalogueBootstrapEnabled("false"), false); assert.equal(catalogueBootstrapEnabled("true"), true);
  const route = readFileSync(new URL("../app/api/club/internal/catalogue-bootstrap/route.ts", import.meta.url), "utf8"); const source = readFileSync(new URL("../lib/madhouse-catalogue.ts", import.meta.url), "utf8");
  assert.match(route, /export async function POST/); assert.match(route, /if \(!catalogueBootstrapEnabled\(\)\)[^;]+404/); assert.match(route, /supabase\.auth\.getUser\(\)/); assert.match(route, /member\.userId === user\.id[\s\S]+member\.role === "owner"/); assert.match(route, /confirmation[^;]+MADHOUSE_CATALOGUE_BOOTSTRAP_CONFIRMATION/);
  assert.match(route, /body\?\.mode !== "create_missing"/); assert.match(route, /repository\.listMembers[\s\S]+reconcileMadhouseCatalogue\(repository\)/);
  assert.doesNotMatch(route + source, /SUPABASE_SERVICE_ROLE_KEY|club_assign_product|assignProduct\(/); assert.doesNotMatch(route, /db8c0932-ec65-40c7-b054-05b820078e5c/);
  assert.doesNotMatch(source, /\.from\(|\.insert\(|\.upsert\(/); assert.match(source, /repository\.createProduct\(createInput\)/);
});
