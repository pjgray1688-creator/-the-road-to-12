import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubRepository } from "./club-repository";
import type { ClubProduct, ClubRole, EntitlementGrant, GrantSource, Membership, Organisation, OrganisationBranding, OrganisationLocation, OrganisationMember, ProductEntitlement } from "./club";

type Row = Record<string, unknown>;
type SupabaseFailure = { message?: string; code?: string };
export type ClubRepositoryError = Error & { code: "UNAVAILABLE" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "FAILED"; operation: string };

const roles: ClubRole[] = ["member", "trainer", "gym_staff", "gym_admin", "owner", "guest"];
const productKinds: ClubProduct["kind"][] = ["membership", "class", "pt", "transformation"];
const billingKinds: ClubProduct["billing"][] = ["one_off", "recurring", "manual"];
const scopes: ProductEntitlement["scope"][] = ["organisation", "locations", "future_locations"];
const allowancePeriods = ["week", "month", "block"] as const;
type AllowancePeriod = typeof allowancePeriods[number];
const sources: GrantSource[] = ["purchase", "subscription", "staff_assignment", "promotion", "migration", "founding"];
const membershipStatuses: Membership["status"][] = ["active", "paused", "expired", "cancelled"];

const safeError = (operation: string, failure?: SupabaseFailure | null, code: ClubRepositoryError["code"] = "FAILED"): never => {
  if (failure && process.env.NODE_ENV !== "test") console.error(`[club-repository] ${operation}`, { code: failure.code, message: failure.message });
  const error = new Error(code === "NOT_FOUND" ? "Club record not found" : code === "FORBIDDEN" ? "Club operation is not permitted" : code === "INVALID" ? "Club operation is invalid" : "Club data is unavailable") as ClubRepositoryError;
  error.code = code; error.operation = operation; throw error;
};

const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const optionalString = (value: unknown) => typeof value === "string" && value.length ? value : undefined;
const safeAsset = (value: unknown) => typeof value === "string" && /^\/[a-zA-Z0-9/_\-.]+$/.test(value) && !value.includes("..") && !value.startsWith("//") ? value : undefined;
const safeColour = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;

export function mapOrganisationBranding(value: unknown): OrganisationBranding {
  const candidate = row(value);
  if (candidate.coBranding !== "co_branded" && candidate.coBranding !== "r12") return { coBranding: "r12" };
  const displayName = typeof candidate.displayName === "string" && candidate.displayName.trim().length <= 80 ? candidate.displayName.trim() || undefined : undefined;
  return {
    coBranding: candidate.coBranding,
    ...(displayName ? { displayName } : {}),
    ...(safeAsset(candidate.logoSrc) ? { logoSrc: safeAsset(candidate.logoSrc) } : {}),
    ...(safeAsset(candidate.logoDarkSrc) ? { logoDarkSrc: safeAsset(candidate.logoDarkSrc) } : {}),
    ...(safeAsset(candidate.logoLightSrc) ? { logoLightSrc: safeAsset(candidate.logoLightSrc) } : {}),
    ...(safeColour(candidate.primaryAccent) ? { primaryAccent: safeColour(candidate.primaryAccent) } : {}),
    ...(safeColour(candidate.secondaryAccent) ? { secondaryAccent: safeColour(candidate.secondaryAccent) } : {}),
    ...(safeAsset(candidate.backgroundSrc) ? { backgroundSrc: safeAsset(candidate.backgroundSrc) } : {}),
  };
}

export function mapOrganisation(value: unknown): Organisation {
  const item = row(value);
  return { id: String(item.id), name: String(item.name), slug: String(item.slug), active: item.active === true, branding: mapOrganisationBranding(item.branding) };
}
export function mapLocation(value: unknown): OrganisationLocation { const item = row(value); return { id: String(item.id), organisationId: String(item.organisation_id), name: String(item.name), active: item.active === true }; }
export function mapMember(value: unknown): OrganisationMember { const item = row(value); const role = String(item.role) as ClubRole; if (!roles.includes(role)) safeError("map_member", undefined, "INVALID"); return { id: String(item.id), organisationId: String(item.organisation_id), userId: String(item.user_id), role, active: item.active === true }; }

export function mapProductEntitlement(value: unknown): ProductEntitlement {
  const item = row(value); const scope = String(item.scope) as ProductEntitlement["scope"];
  if (!scopes.includes(scope)) safeError("map_product_entitlement", undefined, "INVALID");
  const allowancePeriod = optionalString(item.allowance_period) as AllowancePeriod;
  const discountPeriod = optionalString(item.discount_period);
  return {
    productId: String(item.product_id), entitlementKey: String(item.entitlement_key), scope,
    ...(Array.isArray(item.location_ids) ? { locationIds: item.location_ids.map(String) } : {}),
    ...(item.allowance_quantity != null && allowancePeriods.includes(allowancePeriod) ? { allowance: { quantity: Number(item.allowance_quantity), period: allowancePeriod } } : {}),
    ...(item.discount_percent != null ? { discount: { percent: Number(item.discount_percent), ...(discountPeriod === "month" ? { period: "month" as const } : {}), ...(item.discount_max_uses != null ? { maxUses: Number(item.discount_max_uses) } : {}) } } : {}),
  };
}

export function mapProduct(value: unknown, definitions: unknown[] = []): ClubProduct {
  const item = row(value); const kind = String(item.kind) as ClubProduct["kind"]; const billing = String(item.billing) as ClubProduct["billing"];
  if (!productKinds.includes(kind) || !billingKinds.includes(billing)) safeError("map_product", undefined, "INVALID");
  const ordered = [...definitions].sort((a, b) => Number(row(a).position) - Number(row(b).position));
  return { id: String(item.id), organisationId: String(item.organisation_id), name: String(item.name), kind, priceMinor: Number(item.price_minor), currency: String(item.currency), billing, ...(item.duration_days != null ? { durationDays: Number(item.duration_days) } : {}), sellable: item.sellable === true, ...(optionalString(item.archived_at) ? { archivedAt: String(item.archived_at) } : {}), entitlements: ordered.map(mapProductEntitlement) };
}

export function mapGrant(value: unknown): EntitlementGrant {
  const item = row(value); const source = String(item.source) as GrantSource; const scope = String(item.scope) as ProductEntitlement["scope"];
  if (!sources.includes(source) || !scopes.includes(scope)) safeError("map_grant", undefined, "INVALID");
  return {
    id: String(item.id), userId: String(item.user_id), organisationId: String(item.organisation_id), ...(item.membership_id ? { membershipId: String(item.membership_id) } : {}), entitlementKey: String(item.entitlement_key), scope,
    ...(Array.isArray(item.location_ids) && item.location_ids.length ? { locationIds: item.location_ids.map(String) } : {}), validity: { startsAt: String(item.starts_at), ...(item.ends_at ? { endsAt: String(item.ends_at) } : {}) }, source,
    ...(item.allowance_quantity != null && allowancePeriods.includes(item.allowance_period as typeof allowancePeriods[number]) ? { allowance: { quantity: Number(item.allowance_quantity), period: item.allowance_period as typeof allowancePeriods[number] } } : {}),
    ...(item.discount_percent != null ? { discount: { percent: Number(item.discount_percent), ...(item.discount_period === "month" ? { period: "month" as const } : {}), ...(item.discount_max_uses != null ? { maxUses: Number(item.discount_max_uses) } : {}) } } : {}),
  };
}

const rpcEntitlements = (definitions: ProductEntitlement[]) => definitions.map(definition => ({ entitlement_key: definition.entitlementKey, scope: definition.scope, ...(definition.locationIds ? { location_ids: definition.locationIds } : {}), ...(definition.allowance ? { allowance_quantity: definition.allowance.quantity, allowance_period: definition.allowance.period } : {}), ...(definition.discount ? { discount_percent: definition.discount.percent, ...(definition.discount.period ? { discount_period: definition.discount.period } : {}), ...(definition.discount.maxUses !== undefined ? { discount_max_uses: definition.discount.maxUses } : {}) } : {}) }));
const productRpcArguments = (product: Omit<ClubProduct, "id"> | ClubProduct) => ({ p_name: product.name, p_kind: product.kind, p_price_minor: product.priceMinor, p_currency: product.currency, p_billing: product.billing, p_duration_days: product.durationDays ?? null, p_sellable: product.sellable, p_archived_at: product.archivedAt ?? null, p_entitlements: rpcEntitlements(product.entitlements ?? []) });

export class SupabaseClubRepository implements ClubRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listOrganisations() { const { data, error } = await this.client.from("club_organisations").select("*").order("name"); if (error) safeError("list_organisations", error); return rows(data).map(mapOrganisation); }
  async listLocations(organisationId: string) { const { data, error } = await this.client.from("club_locations").select("*").eq("organisation_id", organisationId).order("name"); if (error) safeError("list_locations", error); return rows(data).map(mapLocation); }
  async listMembers(organisationId: string) { const { data, error } = await this.client.from("club_members").select("*").eq("organisation_id", organisationId).order("created_at"); if (error) safeError("list_members", error); return rows(data).map(mapMember); }

  async listProducts(organisationId: string, includeArchived = false) {
    let productQuery = this.client.from("club_products").select("*").eq("organisation_id", organisationId).order("name");
    if (!includeArchived) productQuery = productQuery.eq("sellable", true).is("archived_at", null);
    const [productsResult, definitionsResult] = await Promise.all([productQuery, this.client.from("club_product_entitlements").select("*").eq("organisation_id", organisationId).order("product_id").order("position")]);
    if (productsResult.error) safeError("list_products", productsResult.error); if (definitionsResult.error) safeError("list_product_entitlements", definitionsResult.error);
    const definitions = rows(definitionsResult.data); return rows(productsResult.data).map(product => mapProduct(product, definitions.filter(definition => definition.product_id === product.id)));
  }

  async createProduct(product: Omit<ClubProduct, "id">) {
    const { data, error } = await this.client.rpc("club_create_product", { p_organisation_id: product.organisationId, ...productRpcArguments(product) });
    if (error) safeError("create_product", error, error.code === "42501" ? "FORBIDDEN" : "FAILED"); const result = row(data); return mapProduct(result.product, rows(result.entitlements));
  }

  async updateProduct(id: string, patch: Partial<ClubProduct>) {
    const { data: currentRow, error: currentError } = await this.client.from("club_products").select("*").eq("id", id).maybeSingle();
    if (currentError) safeError("update_product_lookup", currentError); if (!currentRow) safeError("update_product_lookup", undefined, "NOT_FOUND");
    const currentOrganisation = String((currentRow as Row).organisation_id); if (patch.organisationId !== undefined && patch.organisationId !== currentOrganisation) safeError("update_product", undefined, "INVALID");
    const { data: definitionRows, error: definitionError } = await this.client.from("club_product_entitlements").select("*").eq("product_id", id).order("position");
    if (definitionError) safeError("update_product_lookup", definitionError);
    const current = mapProduct(currentRow, rows(definitionRows)); const intended: ClubProduct = { ...current, ...patch, id, organisationId: currentOrganisation, entitlements: patch.entitlements ?? current.entitlements };
    const { data, error } = await this.client.rpc("club_update_product", { p_product_id: id, ...productRpcArguments(intended) });
    if (error) safeError("update_product", error, error.code === "42501" ? "FORBIDDEN" : error.code === "P0002" ? "NOT_FOUND" : "FAILED"); const result = row(data); return mapProduct(result.product, rows(result.entitlements));
  }

  async assignProduct(input: { organisationId: string; productId: string; userId: string; source: GrantSource; validity: { startsAt: string; endsAt?: string }; holderUserIds?: string[] }) {
    const holderUserIds = input.holderUserIds?.length ? [...new Set(input.holderUserIds)] : [input.userId];
    const { data, error } = await this.client.rpc("club_assign_product", { p_organisation_id: input.organisationId, p_product_id: input.productId, p_holder_user_ids: holderUserIds, p_starts_at: input.validity.startsAt, p_ends_at: input.validity.endsAt ?? null, p_source: input.source });
    if (error) safeError("assign_product", error, error.code === "42501" ? "FORBIDDEN" : error.code === "P0002" ? "NOT_FOUND" : "FAILED");
    const result = row(data); const membershipRow = row(result.membership); const holders = rows(result.holders).map(holder => String(holder.user_id)); const status = String(membershipRow.status) as Membership["status"]; const source = String(membershipRow.source) as GrantSource;
    if (!membershipStatuses.includes(status) || !sources.includes(source)) safeError("map_membership", undefined, "INVALID");
    const membership: Membership = { id: String(membershipRow.id), organisationId: String(membershipRow.organisation_id), productId: String(membershipRow.product_id), ...(membershipRow.billing_group_id ? { billingGroupId: String(membershipRow.billing_group_id) } : {}), status, validity: { startsAt: String(membershipRow.starts_at), ...(membershipRow.ends_at ? { endsAt: String(membershipRow.ends_at) } : {}) }, source, holderUserIds: holders };
    return { membership, grants: rows(result.grants).map(mapGrant) };
  }
}
