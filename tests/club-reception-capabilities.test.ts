import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("reception member actions use the live capability boundary", () => {
  const source = readFileSync("app/club/members/actions.ts", "utf8");
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "members\.create"\)/);
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "members\.link_account"\)/);
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "memberships\.assign"\)/);
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "memberships\.end_immediately"\)/);
  assert.match(source, /effectiveAt <= Date\.now\(\)/);
});

test("account linking validates active same-organisation identity before mutation", () => {
  const source = readFileSync("app/club/members/actions.ts", "utf8");
  assert.match(source, /listCustomers\(context\.organisation\.id\)/);
  assert.match(source, /listMembers\(context\.organisation\.id\)/);
  assert.match(source, /item\.userId === input\.userId && item\.active/);
  assert.match(source, /already linked to another person/);
  assert.match(source, /already linked to a different R12 account/);
});

test("repository capability helper calls the authenticated-actor RPC", () => {
  const source = readFileSync("lib/supabase-club-repository.ts", "utf8");
  assert.match(source, /rpc\("club_capability_allowed"/);
  assert.match(source, /p_user_id: userId/);
});
