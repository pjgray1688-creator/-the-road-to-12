import type { ClubProduct, ProductEntitlement } from "./club";
import type { ClubRepository } from "./club-repository";

export const MADHOUSE_PRODUCTION_ORGANISATION_ID = "fa44592a-1593-4ad3-a621-63a4a4bcbceb";
export const MADHOUSE_CATALOGUE_BOOTSTRAP_CONFIRMATION = "bootstrap-madhouse-catalogue";

export type CatalogueEntitlement = Omit<ProductEntitlement, "productId">;
export type CatalogueProduct = Omit<ClubProduct, "id" | "organisationId" | "entitlements"> & { entitlements: CatalogueEntitlement[] };
export type CatalogueBootstrapResult = { name: string; status: "created" | "already_matching" | "drift_detected" | "failed"; detail?: string };

const gymAccess: CatalogueEntitlement = { entitlementKey: "gym_access", scope: "future_locations" };
const transformation = (weeklyPtCredits: number): CatalogueEntitlement[] => [
  gymAccess,
  { entitlementKey: "enhanced_training", scope: "organisation" },
  { entitlementKey: "nutrition", scope: "organisation" },
  { entitlementKey: "trainer_managed", scope: "organisation" },
  { entitlementKey: "pt_session_credit", scope: "organisation", allowance: { quantity: weeklyPtCredits, period: "week" } },
];

export const madhouseCatalogue: readonly CatalogueProduct[] = [
  { name: "Gym Day Pass", kind: "membership", priceMinor: 500, currency: "GBP", billing: "one_off", durationDays: 1, sellable: true, entitlements: [gymAccess] },
  { name: "Week Pass", kind: "membership", priceMinor: 1200, currency: "GBP", billing: "one_off", durationDays: 7, sellable: true, entitlements: [gymAccess] },
  { name: "Concession Monthly", kind: "membership", priceMinor: 2200, currency: "GBP", billing: "recurring", sellable: true, entitlements: [gymAccess] },
  { name: "Standard Monthly", kind: "membership", priceMinor: 2700, currency: "GBP", billing: "recurring", sellable: true, entitlements: [gymAccess, { entitlementKey: "class_access", scope: "organisation", allowance: { quantity: 4, period: "month" } }] },
  { name: "Couples Membership", kind: "membership", priceMinor: 4500, currency: "GBP", billing: "recurring", sellable: true, entitlements: [gymAccess] },
  { name: "Yearly Membership", kind: "membership", priceMinor: 25000, currency: "GBP", billing: "recurring", sellable: true, entitlements: [gymAccess, { entitlementKey: "class_access", scope: "organisation", allowance: { quantity: 1, period: "week" } }] },
  { name: "Transformation Bronze", kind: "transformation", priceMinor: 25000, currency: "GBP", billing: "one_off", durationDays: 70, sellable: true, entitlements: transformation(1) },
  { name: "Transformation Silver", kind: "transformation", priceMinor: 40000, currency: "GBP", billing: "one_off", durationDays: 70, sellable: true, entitlements: transformation(2) },
  { name: "Transformation Gold", kind: "transformation", priceMinor: 52500, currency: "GBP", billing: "one_off", durationDays: 70, sellable: true, entitlements: transformation(3) },
  { name: "Single PT Session", kind: "pt", priceMinor: 3000, currency: "GBP", billing: "one_off", sellable: true, entitlements: [{ entitlementKey: "pt_session_credit", scope: "organisation", allowance: { quantity: 1, period: "block" } }] },
  { name: "10 PT Session Block", kind: "pt", priceMinor: 20000, currency: "GBP", billing: "one_off", sellable: true, entitlements: [{ entitlementKey: "pt_session_credit", scope: "organisation", allowance: { quantity: 10, period: "block" } }] },
  { name: "Golden Ticket Founding Membership", kind: "membership", priceMinor: 50000, currency: "GBP", billing: "one_off", sellable: true, entitlements: [gymAccess, { entitlementKey: "discount", scope: "organisation", discount: { percent: 20, period: "month", maxUses: 1 } }] },
] as const;

// £3 member and £5 non-member class purchases are deliberately excluded: they
// are booking/commerce prices, not durable entitlement definitions in this model.

export function materialiseCatalogueProduct(definition: CatalogueProduct, organisationId: string, productId = `catalogue:${definition.name}`): ClubProduct {
  return { ...definition, id: productId, organisationId, entitlements: definition.entitlements.map(entitlement => ({ ...entitlement, productId })) };
}

const canonicalEntitlement = (entitlement: Omit<ProductEntitlement, "productId"> | ProductEntitlement) => JSON.stringify({
  entitlementKey: entitlement.entitlementKey,
  scope: entitlement.scope,
  locationIds: [...(entitlement.locationIds ?? [])].sort(),
  allowance: entitlement.allowance ? { quantity: entitlement.allowance.quantity, period: entitlement.allowance.period } : null,
  discount: entitlement.discount ? { percent: entitlement.discount.percent, period: entitlement.discount.period ?? null, maxUses: entitlement.discount.maxUses ?? null } : null,
});

export function catalogueProductMatches(existing: ClubProduct, expected: CatalogueProduct): boolean {
  const existingEntitlements = (existing.entitlements ?? []).map(canonicalEntitlement).sort();
  const expectedEntitlements = expected.entitlements.map(canonicalEntitlement).sort();
  return existing.name === expected.name && existing.kind === expected.kind && existing.priceMinor === expected.priceMinor && existing.currency === expected.currency && existing.billing === expected.billing && existing.durationDays === expected.durationDays && existing.sellable === expected.sellable && existing.archivedAt === expected.archivedAt && JSON.stringify(existingEntitlements) === JSON.stringify(expectedEntitlements);
}

/** Exact organisation + product name is the only installed stable reconciliation key.
 * Run deliberately and serially; a future unique product code is recommended. */
export async function reconcileMadhouseCatalogue(repository: ClubRepository, organisationId = MADHOUSE_PRODUCTION_ORGANISATION_ID): Promise<CatalogueBootstrapResult[]> {
  const existing = await repository.listProducts(organisationId, true); const results: CatalogueBootstrapResult[] = [];
  for (const definition of madhouseCatalogue) {
    const matches = existing.filter(product => product.name === definition.name);
    if (matches.length > 1) { results.push({ name: definition.name, status: "drift_detected", detail: "duplicate_exact_name" }); continue; }
    if (matches.length === 1) { results.push({ name: definition.name, status: catalogueProductMatches(matches[0], definition) ? "already_matching" : "drift_detected", ...(catalogueProductMatches(matches[0], definition) ? {} : { detail: "catalogue_difference" }) }); continue; }
    try {
      const candidate = materialiseCatalogueProduct(definition, organisationId); const { id: _catalogueId, ...createInput } = candidate;
      await repository.createProduct(createInput); results.push({ name: definition.name, status: "created" });
    } catch { results.push({ name: definition.name, status: "failed", detail: "create_failed" }); }
  }
  return results;
}

export function catalogueBootstrapEnabled(value = process.env.R12_CLUB_CATALOGUE_BOOTSTRAP_ENABLED): boolean { return value === "true"; }
