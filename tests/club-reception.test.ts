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
  const source = readFileSync("app/club/reception/page.tsx", "utf8");
  assert.match(source, /resolveClubOperationalContext/);
  assert.match(source, /isClubStaffRole\(context\.role\)/);
  assert.match(source, /params\?\.org/);
  assert.match(source, /listCashDeclarations\(context\.organisation\.id, "declared"\)/);
  assert.match(source, /reception_load/);
  assert.match(source, /Reception couldn’t be loaded/);
});

test("customer creation and account linking use the audit boundary", () => {
  const source = readFileSync("app/club/members/actions.ts", "utf8");
  assert.match(source, /action: "person\.created"/);
  assert.match(source, /action: "customer\.account_linked"/);
});
