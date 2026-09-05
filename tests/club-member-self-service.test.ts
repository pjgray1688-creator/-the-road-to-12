import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/club/page.tsx", "utf8");
const home = readFileSync("components/club-member-home.tsx", "utf8");
const nav = readFileSync("components/app-nav.tsx", "utf8");

test("member Club home uses authenticated operational reads rather than staff data", () => {
  assert.match(page, /getMemberOperationalProfile\(context\.organisation\.id, user\.id\)/);
  assert.match(page, /club_get_member_billing/);
  assert.match(home, /MemberClubUnavailable/);
  assert.match(home, /order\.userId === profile\.member\.userId/);
  assert.match(home, /order\.customerId === profile\.customer\.id/);
});

test("member Club home exposes real self-service destinations and truthful limitations", () => {
  for (const label of ["MEMBERSHIP & ACCESS", "BILLING", "ENTITLEMENTS & CREDITS", "MADHOUSE BALANCE", "CLASSES", "SERVICES", "ORDERS & RECEIPTS", "LOCATIONS"]) assert.match(home, new RegExp(label));
  assert.match(home, /monthly availability is checked at checkout/);
  assert.doesNotMatch(home, /unlock door|door hardware|fake payment/i);
  assert.match(home, /\/club\/classes/);
  assert.match(home, /\/club\/membership-billing/);
  assert.match(home, /\/club\/join/);
  assert.match(home, /\/club\/shop\/balance/);
  assert.match(nav, /href: "\/club", label: "Club"/);
});
