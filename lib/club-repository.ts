import { type ClubProduct, type EntitlementGrant, type Membership, type Organisation, type OrganisationLocation, type OrganisationMember, type GrantSource, type Validity } from "./club";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseClubRepository, type ClubRepositoryError } from "./supabase-club-repository";
import { madhouseCatalogue, materialiseCatalogueProduct } from "./madhouse-catalogue";

export type ClubRepository = { listOrganisations(): Promise<Organisation[]>; listLocations(organisationId: string): Promise<OrganisationLocation[]>; listProducts(organisationId: string, includeArchived?: boolean): Promise<ClubProduct[]>; listMembers(organisationId: string): Promise<OrganisationMember[]>; createProduct(product: Omit<ClubProduct, "id">): Promise<ClubProduct>; updateProduct(id: string, patch: Partial<ClubProduct>): Promise<ClubProduct>; assignProduct(input: { organisationId: string; productId: string; userId: string; source: GrantSource; validity: Validity; holderUserIds?: string[] }): Promise<{ membership: Membership; grants: EntitlementGrant[] }>; };

export const madhouseFixture: Organisation = { id: "org-madhouse", name: "Madhouse Gym", slug: "madhouse-gym", active: true, branding: { coBranding: "co_branded" } };
export const madhouseLocations: OrganisationLocation[] = [{ id: "loc-rotherham", organisationId: madhouseFixture.id, name: "Rotherham", active: true }, { id: "loc-carlton", organisationId: madhouseFixture.id, name: "Carlton", active: true }];
const fixtureProducts = (): ClubProduct[] => madhouseCatalogue.map((definition, index) => materialiseCatalogueProduct(definition, madhouseFixture.id, `product-${index + 1}`));

export class MemoryClubRepository implements ClubRepository {
  organisations = [madhouseFixture]; locations = [...madhouseLocations]; products = fixtureProducts(); members: OrganisationMember[] = []; memberships: Membership[] = []; grants: EntitlementGrant[] = [];
  async listOrganisations() { return this.organisations.filter(item => item.active); }
  async listLocations(organisationId: string) { return this.locations.filter(item => item.organisationId === organisationId); }
  async listProducts(organisationId: string, includeArchived = false) { return this.products.filter(item => item.organisationId === organisationId && (includeArchived || item.sellable)); }
  async listMembers(organisationId: string) { return this.members.filter(item => item.organisationId === organisationId && item.active); }
  async createProduct(product: Omit<ClubProduct, "id">) { const existing = this.products.find(item => item.organisationId === product.organisationId && item.name === product.name); if (existing) return existing; const created = { ...product, id: `product-${this.products.length + 1}` }; this.products.push(created); return created; }
  async updateProduct(id: string, patch: Partial<ClubProduct>) { const index = this.products.findIndex(item => item.id === id); if (index < 0) throw new Error("product_not_found"); this.products[index] = { ...this.products[index], ...patch }; return this.products[index]; }
  async assignProduct(input: { organisationId: string; productId: string; userId: string; source: GrantSource; validity: Validity; holderUserIds?: string[] }) { const product = this.products.find(item => item.id === input.productId && item.organisationId === input.organisationId); if (!product) throw new Error("product_not_found"); const holderUserIds = input.holderUserIds?.length ? [...new Set(input.holderUserIds)] : [input.userId]; const membership: Membership = { id: `membership-${this.memberships.length + 1}`, organisationId: input.organisationId, productId: product.id, status: "active", validity: input.validity, source: input.source, holderUserIds }; this.memberships.push(membership); const grants = holderUserIds.flatMap(userId => (product.entitlements ?? []).map((benefit, index) => ({ id: `${membership.id}-${userId}-${index}`, userId, organisationId: input.organisationId, membershipId: membership.id, entitlementKey: benefit.entitlementKey, scope: benefit.scope, locationIds: benefit.locationIds, validity: input.validity, source: input.source, allowance: benefit.allowance, discount: benefit.discount }))); this.grants.push(...grants); return { membership, grants }; }
}
let memoryInstance: MemoryClubRepository | undefined;
export function memoryClubRepository(): MemoryClubRepository { if (!memoryInstance) memoryInstance = new MemoryClubRepository(); return memoryInstance; }
export function selectClubRepository(options: { client?: SupabaseClient; nodeEnv?: string; schemaEnabled?: string }): ClubRepository {
  if (options.nodeEnv !== "production") return memoryClubRepository();
  if (options.schemaEnabled !== "true" || !options.client) { const error = new Error("Club data is unavailable") as ClubRepositoryError; error.code = "UNAVAILABLE"; error.operation = "select_repository"; throw error; }
  return new SupabaseClubRepository(options.client);
}
export function clubRepository(client?: SupabaseClient): ClubRepository { return selectClubRepository({ client, nodeEnv: process.env.NODE_ENV, schemaEnabled: process.env.R12_CLUB_SCHEMA_ENABLED }); }
export { SupabaseClubRepository } from "./supabase-club-repository";
