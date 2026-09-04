import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryClubRepository, selectClubRepository } from "../lib/club-repository";
import { SupabaseClubRepository, mapClassAvailability, mapClassBooking, mapClassSession, mapCustomer, mapOrganisation, mapProduct, mapServiceTransaction } from "../lib/supabase-club-repository";
import { resolveOrganisationTheme, type ClubProduct } from "../lib/club";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type RpcCall = { name: string; args: Record<string, unknown> };

function query(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "maybeSingle"]) chain[method] = () => chain;
  chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fakeClient(options: { tables?: Record<string, Result[]>; rpcs?: Record<string, Result> } = {}) {
  const tableCalls: string[] = []; const rpcCalls: RpcCall[] = [];
  const client = {
    from(name: string) { tableCalls.push(name); const result = options.tables?.[name]?.shift() ?? { data: [], error: null }; return query(result); },
    async rpc(name: string, args: Record<string, unknown>) { rpcCalls.push({ name, args }); return options.rpcs?.[name] ?? { data: null, error: null }; },
  } as unknown as SupabaseClient;
  return { client, tableCalls, rpcCalls };
}

const productRow = { id: "product-1", organisation_id: "org-1", name: "Golden Ticket", kind: "membership", price_minor: 50000, currency: "GBP", billing: "one_off", duration_days: null, sellable: true, archived_at: null };
const definitionRows = [
  { id: "def-2", product_id: "product-1", organisation_id: "org-1", position: 1, entitlement_key: "discount", scope: "organisation", location_ids: null, allowance_quantity: null, allowance_period: null, discount_percent: "20", discount_period: "month", discount_max_uses: 1 },
  { id: "def-1", product_id: "product-1", organisation_id: "org-1", position: 0, entitlement_key: "gym_access", scope: "future_locations", location_ids: null, allowance_quantity: null, allowance_period: null, discount_percent: null, discount_period: null, discount_max_uses: null },
];
const rpcProduct = { product: productRow, entitlements: definitionRows };

test("Club repository selection uses Supabase in production when configured and keeps an explicit kill-switch", () => {
  const fake = fakeClient();
  assert.ok(selectClubRepository({ client: fake.client, nodeEnv: "production", schemaEnabled: undefined }) instanceof SupabaseClubRepository);
  assert.throws(() => selectClubRepository({ client: fake.client, nodeEnv: "production", schemaEnabled: "false" }), (error: unknown) => error instanceof Error && error.message === "Club data is unavailable");
  assert.ok(selectClubRepository({ nodeEnv: "test" }) instanceof MemoryClubRepository);
  assert.ok(selectClubRepository({ client: fake.client, nodeEnv: "production", schemaEnabled: "true" }) instanceof SupabaseClubRepository);
});

test("Supabase organisation, location and member reads map empty and populated RLS results", async () => {
  const fake = fakeClient({ tables: {
    club_organisations: [{ data: [{ id: "org-1", name: "R12 North", slug: "r12-north", active: true, branding: { coBranding: "co_branded", primaryAccent: "#123456", logoSrc: "/brand/logo.svg" } }], error: null }],
    club_locations: [{ data: [{ id: "loc-1", organisation_id: "org-1", name: "North", active: true }], error: null }],
    club_members: [{ data: [{ id: "member-1", organisation_id: "org-1", user_id: "user-1", role: "gym_admin", active: true }], error: null }],
  } });
  const repository = new SupabaseClubRepository(fake.client);
  assert.deepEqual((await repository.listOrganisations())[0].branding, { coBranding: "co_branded", logoSrc: "/brand/logo.svg", primaryAccent: "#123456" });
  assert.deepEqual(await repository.listLocations("org-1"), [{ id: "loc-1", organisationId: "org-1", name: "North", active: true }]);
  assert.equal((await repository.listMembers("org-1"))[0].role, "gym_admin");
  const empty = new SupabaseClubRepository(fakeClient().client); assert.deepEqual(await empty.listOrganisations(), []);
});

test("Club identity resolver maps authorised account profile data without exposing auth records", async () => {
  const fake = fakeClient({ rpcs: { club_resolve_member_identity: { data: { user_id: "user-1", display_name: "Peter Gray", email: "peter@example.com" }, error: null } } });
  const identity = await new SupabaseClubRepository(fake.client).resolveMemberIdentity("org-1", "user-1");
  assert.deepEqual(identity, { userId: "user-1", displayName: "Peter Gray", email: "peter@example.com" });
  assert.equal(fake.rpcCalls[0].name, "club_resolve_member_identity");
  assert.equal(fake.tableCalls.length, 0);
});

test("malformed organisation branding falls back to constrained R12 branding", () => {
  const organisation = mapOrganisation({ id: "org", name: "Unsafe", slug: "unsafe", active: true, branding: { coBranding: "white_label", primaryAccent: "red", logoSrc: "javascript:alert(1)", backgroundSrc: "https://remote.invalid/a" } });
  assert.deepEqual(organisation.branding, { coBranding: "r12" });
  const theme = resolveOrganisationTheme(organisation); assert.equal(theme.platform, "R12"); assert.equal(theme.coBranding, "r12"); assert.equal(theme.primaryAccent, "#a855f7"); assert.equal(theme.logoSrc, undefined);
});

test("Supabase products reconstruct definitions in position order with allowance and discount metadata", async () => {
  const allowance = { ...definitionRows[0], id: "def-3", position: 2, entitlement_key: "pt_session_credit", discount_percent: null, discount_period: null, discount_max_uses: null, allowance_quantity: 3, allowance_period: "week" };
  const fake = fakeClient({ tables: { club_products: [{ data: [productRow], error: null }], club_product_entitlements: [{ data: [allowance, ...definitionRows], error: null }] } });
  const products = await new SupabaseClubRepository(fake.client).listProducts("org-1");
  assert.deepEqual(products[0].entitlements?.map(item => item.entitlementKey), ["gym_access", "discount", "pt_session_credit"]);
  assert.equal(products[0].entitlements?.[0].scope, "future_locations");
  assert.deepEqual(products[0].entitlements?.[1].discount, { percent: 20, period: "month", maxUses: 1 });
  assert.deepEqual(products[0].entitlements?.[2].allowance, { quantity: 3, period: "week" });
});

test("createProduct uses only the transactional create RPC and maps its product aggregate", async () => {
  const fake = fakeClient({ rpcs: { club_create_product: { data: rpcProduct, error: null } } }); const repository = new SupabaseClubRepository(fake.client);
  const input: Omit<ClubProduct, "id"> = { organisationId: "org-1", name: "Golden Ticket", kind: "membership", priceMinor: 50000, currency: "GBP", billing: "one_off", sellable: true, entitlements: mapProduct(productRow, definitionRows).entitlements };
  const created = await repository.createProduct(input); assert.equal(created.entitlements?.[0].scope, "future_locations"); assert.equal(fake.rpcCalls[0].name, "club_create_product"); assert.equal(fake.tableCalls.length, 0);
  assert.deepEqual((fake.rpcCalls[0].args.p_entitlements as Array<Record<string, unknown>>)[1], { entitlement_key: "discount", scope: "organisation", discount_percent: 20, discount_period: "month", discount_max_uses: 1 });
});

test("updateProduct reads the current aggregate then uses only the transactional update RPC", async () => {
  const fake = fakeClient({ tables: { club_products: [{ data: productRow, error: null }], club_product_entitlements: [{ data: definitionRows, error: null }] }, rpcs: { club_update_product: { data: { product: { ...productRow, name: "Updated" }, entitlements: definitionRows }, error: null } } });
  const updated = await new SupabaseClubRepository(fake.client).updateProduct("product-1", { name: "Updated" }); assert.equal(updated.name, "Updated"); assert.equal(fake.rpcCalls[0].name, "club_update_product"); assert.equal(fake.rpcCalls[0].args.p_name, "Updated");
  assert.deepEqual(fake.tableCalls, ["club_products", "club_product_entitlements"]);
});

test("assignProduct uses only the assignment RPC and maps independent multi-holder grants", async () => {
  const membership = { id: "membership-1", organisation_id: "org-1", product_id: "product-1", billing_group_id: null, status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: null, source: "founding" };
  const grant = (id: string, user: string, definition: Record<string, unknown>) => ({ id, user_id: user, organisation_id: "org-1", membership_id: "membership-1", starts_at: membership.starts_at, ends_at: null, source: "founding", location_ids: [], allowance_quantity: null, allowance_period: null, discount_percent: null, discount_period: null, discount_max_uses: null, ...definition });
  const grants = [grant("g1", "holder-a", { entitlement_key: "gym_access", scope: "future_locations" }), grant("g2", "holder-b", { entitlement_key: "gym_access", scope: "future_locations" }), grant("g3", "holder-a", { entitlement_key: "discount", scope: "organisation", discount_percent: "20", discount_period: "month", discount_max_uses: 1 }), grant("g4", "holder-b", { entitlement_key: "pt_session_credit", scope: "organisation", allowance_quantity: 1, allowance_period: "week" })];
  const fake = fakeClient({ rpcs: { club_assign_product: { data: { membership, holders: [{ user_id: "holder-a" }, { user_id: "holder-b" }], grants }, error: null } } });
  const result = await new SupabaseClubRepository(fake.client).assignProduct({ organisationId: "org-1", productId: "product-1", userId: "holder-a", holderUserIds: ["holder-a", "holder-b", "holder-a"], source: "founding", validity: { startsAt: membership.starts_at } });
  assert.deepEqual(result.membership.holderUserIds, ["holder-a", "holder-b"]); assert.equal(result.membership.validity.endsAt, undefined); assert.equal(result.grants.filter(item => item.userId === "holder-a").length, 2); assert.equal(result.grants[0].scope, "future_locations"); assert.deepEqual(result.grants[2].discount, { percent: 20, period: "month", maxUses: 1 }); assert.deepEqual(result.grants[3].allowance, { quantity: 1, period: "week" });
  assert.equal(fake.rpcCalls[0].name, "club_assign_product"); assert.deepEqual(fake.rpcCalls[0].args.p_holder_user_ids, ["holder-a", "holder-b"]); assert.equal("p_entitlements" in fake.rpcCalls[0].args, false); assert.equal("p_grants" in fake.rpcCalls[0].args, false); assert.equal(fake.tableCalls.length, 0);
});

test("fixed assignment validity and safe repository errors are mapped without raw database text", async () => {
  const failed = fakeClient({ tables: { club_locations: [{ data: null, error: { code: "XX000", message: "sensitive database detail" } }] } });
  await assert.rejects(() => new SupabaseClubRepository(failed.client).listLocations("org"), (error: unknown) => error instanceof Error && error.message === "Club data is unavailable" && !error.message.includes("sensitive"));
  const fixed = { id: "m", organisation_id: "org", product_id: "p", status: "active", starts_at: "2026-01-01", ends_at: "2026-01-08", source: "staff_assignment" };
  const fake = fakeClient({ rpcs: { club_assign_product: { data: { membership: fixed, holders: [{ user_id: "u" }], grants: [] }, error: null } } });
  const result = await new SupabaseClubRepository(fake.client).assignProduct({ organisationId: "org", productId: "p", userId: "u", source: "staff_assignment", validity: { startsAt: "2026-01-01", endsAt: "2026-01-08" } }); assert.equal(result.membership.validity.endsAt, "2026-01-08");
});

test("Club page uses the repository boundary and contains no direct Club table queries", () => {
  const page = readFileSync(new URL("../app/club/page.tsx", import.meta.url), "utf8"); const repository = readFileSync(new URL("../lib/supabase-club-repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(page, /\.from\(["']club_/); assert.match(page, /listClubOrganisationContexts\(supabase, user\.id\)/); assert.doesNotMatch(repository, /SUPABASE_SERVICE_ROLE_KEY|madhouseFixture/);
  assert.doesNotMatch(repository, /\.from\("club_(?:products|product_entitlements|memberships|membership_holders|entitlement_grants)"\)\.(?:insert|update|delete|upsert)/);
});

test("Supabase operational rows map provider-neutral customer, session, booking and transaction contracts", () => {
  assert.equal(mapCustomer({ id: "c", organisation_id: "o", user_id: null, display_name: "Guest", status: "guest", created_at: "a", updated_at: "b" }).userId, undefined);
  assert.equal(mapClassSession({ id: "s", organisation_id: "o", location_id: "l", class_type_id: "t", starts_at: "a", ends_at: "b", visibility: "public", status: "scheduled", recurrence_metadata: { series: "future" }, created_at: "a", updated_at: "a" }).recurrenceMetadata?.series, "future");
  assert.equal(mapClassBooking({ id: "b", organisation_id: "o", session_id: "s", customer_id: "c", status: "confirmed", booked_at: "a", attendance_state: "pending", created_at: "a", updated_at: "a" }).attendanceState, "pending");
  const transaction = mapServiceTransaction({ id: "x", organisation_id: "o", location_id: "l", service_id: "v", quantity: 1, unit_price_minor: 500, currency: "GBP", payment_status: "paid", payment_method: "wallet", fulfilment_status: "pending", occurred_at: "a", created_at: "a", updated_at: "a" });
  assert.equal(transaction.paymentStatus, "paid"); assert.equal(transaction.fulfilmentStatus, "pending");
  assert.deepEqual(mapClassAvailability({ session_id: "s", capacity: 18, confirmed_count: 14, spaces_remaining: 4, waitlisted_count: 2, is_full: false }), { sessionId: "s", capacity: 18, confirmedCount: 14, spacesRemaining: 4, waitlistedCount: 2, isFull: false });
  assert.deepEqual(mapClassAvailability({ session_id: "u", capacity: null, confirmed_count: 30, spaces_remaining: null, waitlisted_count: 0, is_full: false }), { sessionId: "u", confirmedCount: 30, waitlistedCount: 0, isFull: false });
});

test("Supabase operational reads use RLS tables and all mutations use purpose-specific RPCs", async () => {
  const row = { id: "c", organisation_id: "o", user_id: null, display_name: "Guest", status: "guest", created_at: "a", updated_at: "a" };
  const fake = fakeClient({ tables: { club_customers: [{ data: [row], error: null }], club_class_types: [{ data: [], error: null }], club_class_sessions: [{ data: [], error: null }], club_class_bookings: [{ data: [], error: null }], club_services: [{ data: [], error: null }], club_service_transactions: [{ data: [], error: null }] }, rpcs: { club_create_customer: { data: row, error: null }, club_link_customer_user: { data: { ...row, user_id: "u" }, error: null } } });
  const repository = new SupabaseClubRepository(fake.client);
  assert.equal((await repository.listCustomers("o"))[0].displayName, "Guest"); await repository.listClassTypes("o"); await repository.listClassSessions("o"); await repository.listClassBookings("o"); await repository.listServices("o"); await repository.listServiceTransactions("o");
  await repository.createCustomer({ organisationId: "o", displayName: "Guest", status: "guest" }); await repository.linkCustomerUser("c", "u");
  assert.deepEqual(fake.tableCalls, ["club_customers", "club_class_types", "club_class_sessions", "club_class_bookings", "club_services", "club_service_transactions"]);
  assert.deepEqual(fake.rpcCalls.map(call => call.name), ["club_create_customer", "club_link_customer_user"]);
});

test("Supabase class, booking and service mutations never issue direct table writes", async () => {
  const timestamps = { created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T09:00:00Z" };
  const classType = { id: "type", organisation_id: "org", name: "Mobility", description: null, default_duration_minutes: 45, default_capacity: 2, active: true, ...timestamps };
  const session = { id: "session", organisation_id: "org", location_id: "loc", class_type_id: "type", host_user_id: "trainer", title: null, starts_at: "2026-10-02T10:00:00Z", ends_at: "2026-10-02T10:45:00Z", capacity: 2, booking_opens_at: null, booking_closes_at: null, cancellation_closes_at: null, visibility: "public", status: "scheduled", recurrence_metadata: null, ...timestamps };
  const booking = { id: "booking", organisation_id: "org", session_id: "session", customer_id: "customer", status: "confirmed", booked_at: timestamps.created_at, cancelled_at: null, attendance_state: "pending", entitlement_usage_id: null, payment_reference: null, ...timestamps };
  const service = { id: "service", organisation_id: "org", location_id: null, name: "Facility service", description: null, category: "facility", duration_minutes: 15, price_minor: 500, currency: "GBP", active: true, ...timestamps };
  const transaction = { id: "transaction", organisation_id: "org", location_id: "loc", service_id: "service", customer_id: "customer", staff_user_id: "staff", quantity: 1, unit_price_minor: 500, currency: "GBP", payment_status: "pending", payment_method: "manual", payment_reference: null, fulfilment_status: "pending", external_fulfilment_reference: null, occurred_at: timestamps.created_at, metadata: null, ...timestamps };
  const fake = fakeClient({ rpcs: {
    club_save_class_type: { data: classType, error: null }, club_save_class_session: { data: session, error: null }, club_create_class_booking: { data: booking, error: null }, club_cancel_class_booking: { data: { ...booking, status: "cancelled", cancelled_at: timestamps.updated_at }, error: null }, club_set_booking_attendance: { data: { ...booking, attendance_state: "checked_in" }, error: null }, club_save_service: { data: service, error: null }, club_create_service_transaction: { data: transaction, error: null }, club_update_service_transaction: { data: { ...transaction, payment_status: "paid", fulfilment_status: "fulfilled" }, error: null },
  } });
  const repository = new SupabaseClubRepository(fake.client);
  await repository.saveClassType({ organisationId: "org", name: "Mobility", defaultDurationMinutes: 45, defaultCapacity: 2, active: true });
  await repository.saveClassSession({ organisationId: "org", locationId: "loc", classTypeId: "type", hostUserId: "trainer", startsAt: session.starts_at, endsAt: session.ends_at, capacity: 2, visibility: "public", status: "scheduled" });
  await repository.createClassBooking({ sessionId: "session", customerId: "customer" }); await repository.cancelClassBooking("booking"); await repository.setBookingAttendance("booking", "checked_in");
  await repository.saveService({ organisationId: "org", name: "Facility service", category: "facility", durationMinutes: 15, priceMinor: 500, currency: "GBP", active: true });
  await repository.createServiceTransaction({ organisationId: "org", locationId: "loc", serviceId: "service", customerId: "customer", quantity: 1, unitPriceMinor: 500, currency: "GBP", paymentStatus: "pending", paymentMethod: "manual", fulfilmentStatus: "pending", occurredAt: timestamps.created_at });
  await repository.updateServiceTransaction("transaction", { paymentStatus: "paid", fulfilmentStatus: "fulfilled" });
  assert.deepEqual(fake.rpcCalls.map(call => call.name), ["club_save_class_type", "club_save_class_session", "club_create_class_booking", "club_cancel_class_booking", "club_set_booking_attendance", "club_save_service", "club_create_service_transaction", "club_update_service_transaction"]);
  assert.equal(fake.tableCalls.length, 0);
});

test("Supabase availability uses only the aggregate RPC and exposes no booking rows", async () => {
  const fake = fakeClient({ rpcs: { club_get_class_availability: { data: { session_id: "session", capacity: 18, confirmed_count: 14, spaces_remaining: 4, waitlisted_count: 1, is_full: false }, error: null } } });
  const availability = await new SupabaseClubRepository(fake.client).getClassAvailability("session");
  assert.deepEqual(availability, { sessionId: "session", capacity: 18, confirmedCount: 14, spacesRemaining: 4, waitlistedCount: 1, isFull: false });
  assert.deepEqual(fake.rpcCalls, [{ name: "club_get_class_availability", args: { p_session_id: "session" } }]); assert.equal(fake.tableCalls.length, 0);
});
