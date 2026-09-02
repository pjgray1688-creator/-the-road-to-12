import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryClubRepository } from "../lib/club-repository";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-07-club-classes-bookings-services.sql", import.meta.url), "utf8");
const executable = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
const tables = ["club_customers", "club_class_types", "club_class_sessions", "club_class_bookings", "club_services", "club_service_transactions"];
const rpcs = ["club_save_class_type", "club_save_class_session", "club_create_customer", "club_link_customer_user", "club_create_class_booking", "club_cancel_class_booking", "club_set_booking_attendance", "club_save_service", "club_create_service_transaction", "club_update_service_transaction"];

test("classes, bookings and services use organisation-safe relational tables", () => {
  for (const table of tables) {
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`, "i"));
  }
  assert.match(migration, /foreign key \(location_id, organisation_id\) references public\.club_locations\(id, organisation_id\)/i);
  assert.match(migration, /foreign key \(class_type_id, organisation_id\) references public\.club_class_types\(id, organisation_id\)/i);
  assert.match(migration, /foreign key \(session_id, organisation_id\) references public\.club_class_sessions\(id, organisation_id\)/i);
  assert.match(migration, /foreign key \(customer_id, organisation_id\) references public\.club_customers\(id, organisation_id\)/i);
  assert.match(migration, /foreign key \(service_id, organisation_id\) references public\.club_services\(id, organisation_id\)/i);
});

test("new tables are authenticated-read-only under RLS and unavailable to anon/public", () => {
  assert.match(migration, /revoke all privileges on table[^;]+from public,anon,authenticated;/is);
  assert.match(migration, /grant select on table[^;]+to authenticated;/is);
  assert.doesNotMatch(executable, /grant\s+(?:insert|update|delete|all|truncate|references|trigger)[^;]+to authenticated/i);
  assert.doesNotMatch(executable, /grant[^;]+to\s+(?:anon|public)\b/i);
});

test("all mutations are hardened authenticated RPCs with explicit role checks", () => {
  for (const rpc of rpcs) {
    assert.match(migration, new RegExp(`function public\\.${rpc}\\(`, "i"));
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}\\([^;]+ from public;`, "i"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}\\([^;]+ to authenticated;`, "i"));
  }
  assert.equal((migration.match(/security definer set search_path = pg_catalog, public/gi) ?? []).length >= rpcs.length, true);
  assert.match(migration, /club_save_class_type[\s\S]+array\['gym_admin','owner'\]/i);
  assert.match(migration, /club_save_service[\s\S]+array\['gym_admin','owner'\]/i);
  assert.match(migration, /club_create_service_transaction[\s\S]+array\['gym_staff','gym_admin','owner'\]/i);
  assert.doesNotMatch(migration, /array\[[^\]]*'trainer'[^\]]*\][^;]*service transaction/i);
});

test("trainer authority is host-scoped while owner/admin retain session administration", () => {
  assert.match(migration, /v_existing\.host_user_id=auth\.uid\(\)[\s\S]+p_host_user_id=auth\.uid\(\)[\s\S]+array\['trainer'\]/i);
  assert.match(migration, /v_admin :=[^;]+array\['gym_admin','owner'\]/i);
  assert.match(migration, /club_class_sessions_customer_select[\s\S]+host_user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /club_customers_staff_select[^;]+trainer/i);
});

test("booking creation serializes capacity and blocks invalid or duplicate active bookings", () => {
  const bookingFunction = migration.slice(migration.indexOf("function public.club_create_class_booking"), migration.indexOf("function public.club_cancel_class_booking"));
  assert.match(bookingFunction, /from public\.club_class_sessions where id=p_session_id for update/i);
  assert.match(bookingFunction, /v_session\.status<>'scheduled'/i);
  assert.match(bookingFunction, /booking_opens_at[\s\S]+booking_closes_at/i);
  assert.match(bookingFunction, /count\(\*\)[\s\S]+status='confirmed'[\s\S]+v_count>=v_session\.capacity/i);
  assert.match(migration, /count\(\*\) from public\.club_class_bookings where session_id=p_id and status='confirmed'\) > p_capacity/i);
  assert.match(migration, /unique index club_class_bookings_active_customer_unique[\s\S]+where status in \('confirmed','waitlisted'\)/i);
});

test("customer and transaction records preserve identity and separate lifecycle states", () => {
  assert.match(migration, /user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /club_link_customer_user[\s\S]+set user_id=p_user_id,updated_at=now\(\)/i);
  assert.match(migration, /not v_staff and p_status<>'customer'/i);
  assert.match(migration, /payment_status text[^;]+\('unpaid','pending','paid','waived','refunded'\)/i);
  assert.match(migration, /fulfilment_status text[^;]+\('pending','fulfilled','cancelled','failed'\)/i);
  assert.match(migration, /entitlement_usage_id uuid references public\.club_entitlement_usage/i);
  assert.doesNotMatch(migration.slice(migration.indexOf("function public.club_create_class_booking")), /insert into public\.club_entitlement_usage/i);
});

test("MemoryClubRepository preserves guest history after account linking", async () => {
  const repository = new MemoryClubRepository();
  const guest = await repository.createCustomer({ organisationId: "org-a", displayName: "Guest One", status: "guest" });
  assert.equal(guest.userId, undefined);
  const linked = await repository.linkCustomerUser(guest.id, "user-1");
  assert.equal(linked.id, guest.id); assert.equal(linked.userId, "user-1");
  assert.equal((await repository.listCustomers("org-a"))[0].id, guest.id);
  assert.equal((await repository.listCustomers("org-b")).length, 0);
});

test("MemoryClubRepository enforces same-organisation sessions, duplicate bookings and capacity", async () => {
  const repository = new MemoryClubRepository();
  repository.organisations.push({ id: "org-a", name: "A", slug: "a", active: true }, { id: "org-b", name: "B", slug: "b", active: true });
  repository.locations.push({ id: "loc-a", organisationId: "org-a", name: "A", active: true }, { id: "loc-b", organisationId: "org-b", name: "B", active: true });
  const type = await repository.saveClassType({ organisationId: "org-a", name: "Strength", defaultDurationMinutes: 45, defaultCapacity: 1, active: true });
  await assert.rejects(() => repository.saveClassSession({ organisationId: "org-a", locationId: "loc-b", classTypeId: type.id, startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T11:00:00Z", visibility: "public", status: "scheduled" }), /session_reference_invalid/);
  const session = await repository.saveClassSession({ organisationId: "org-a", locationId: "loc-a", classTypeId: type.id, startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T11:00:00Z", capacity: 1, visibility: "public", status: "scheduled" });
  const first = await repository.createCustomer({ organisationId: "org-a", displayName: "First", status: "customer" }); const second = await repository.createCustomer({ organisationId: "org-a", displayName: "Second", status: "customer" });
  await repository.createClassBooking({ sessionId: session.id, customerId: first.id });
  await assert.rejects(() => repository.createClassBooking({ sessionId: session.id, customerId: first.id }), /booking_duplicate/);
  await assert.rejects(() => repository.createClassBooking({ sessionId: session.id, customerId: second.id }), /booking_capacity/);
  session.status = "cancelled";
  await assert.rejects(() => repository.createClassBooking({ sessionId: session.id, customerId: second.id, status: "waitlisted" }), /booking_invalid/);
});

test("service transactions keep payment and fulfilment independent", async () => {
  const repository = new MemoryClubRepository(); repository.organisations.push({ id: "org-a", name: "A", slug: "a", active: true }); repository.locations.push({ id: "loc-a", organisationId: "org-a", name: "A", active: true });
  const service = await repository.saveService({ organisationId: "org-a", locationId: "loc-a", name: "Recovery booth", category: "recovery", durationMinutes: 15, priceMinor: 800, currency: "GBP", active: true });
  const transaction = await repository.createServiceTransaction({ organisationId: "org-a", locationId: "loc-a", serviceId: service.id, quantity: 1, unitPriceMinor: 800, currency: "GBP", paymentStatus: "pending", paymentMethod: "external_future_provider", fulfilmentStatus: "fulfilled", occurredAt: "2026-10-01T12:00:00Z" });
  assert.equal(transaction.paymentStatus, "pending"); assert.equal(transaction.fulfilmentStatus, "fulfilled"); assert.equal(transaction.paymentMethod, "external_future_provider");
});
