import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("reception composes the unified people search with authoritative workflows", () => {
  const source = readFileSync("components/club-reception.tsx", "utf8");
  assert.match(source, /ClubMemberOnboarding/);
  assert.match(source, /club\/members\/customer/);
  assert.match(source, /club\/members\//);
  assert.match(source, /Digital access awaits account link/);
  assert.match(source, /Declared cash is not confirmed payment/);
  assert.doesNotMatch(source, /Rotherham|Carlton|Golden Ticket/);
});

test("reception route is operationally protected and keeps organisation context", () => {
  const route = readFileSync("app/club/reception/page.tsx", "utf8");
  const overview = readFileSync("app/club/page.tsx", "utf8");
  assert.match(route, /redirect\(`\/club/);
  assert.match(route, /params\?\.org/);
  assert.match(route, /params\?\.location/);
  assert.match(overview, /serverSupabase/);
  assert.match(overview, /auth\.getUser/);
  assert.match(overview, /listClubOrganisationContexts/);
  assert.match(overview, /isClubStaffRole\(role\)/);
  assert.match(overview, /listCashDeclarations\(context\.organisation\.id\)/);
});

test("customer creation and account linking use the audit boundary", () => {
  const source = readFileSync("app/club/members/actions.ts", "utf8");
  assert.match(source, /action: "person\.created"/);
  assert.match(source, /action: "customer\.account_linked"/);
});
