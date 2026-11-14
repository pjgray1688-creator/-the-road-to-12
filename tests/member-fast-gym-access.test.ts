import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { akuvoxA02Response } from "../lib/akuvox-a02-response";

const read = (path: string) => readFileSync(path, "utf8");

test("dedicated access route authenticates, scopes organisation through the member RPC, and fetches only access data", () => {
  const page = read("app/member-hub/access/page.tsx");
  assert.match(page, /auth\.getUser\(\)/);
  assert.match(page, /club_list_my_memberships/);
  assert.match(page, /madhouse\.find\(\(row\) => row\.organisation\?\.id === requestedOrg\)/);
  assert.match(page, /club_get_my_access_pass/);
  assert.match(read("components/member-access-venue-eligibility.tsx"), /club_get_my_access_eligibility/);
  assert.match(page, /<Suspense fallback=/);
  assert.match(page, /await supabase\.rpc\("club_get_my_access_pass"/);
  assert.doesNotMatch(page, /clubRepository|listProducts|listOrders|listClassSessions|balance|training/i);
  assert.match(page, /force-dynamic/);
});

test("the standard Member Hub no longer waits for pass issuance or unrelated access eligibility", () => {
  const page = read("app/member-hub/page.tsx");
  assert.doesNotMatch(page, /club_get_my_access_pass|club_get_my_access_eligibility/);
  assert.match(read("components/member-hub.tsx"), /member-hub\/access\?org=/);
  assert.match(read("lib/home-member-area.ts"), /member-hub\/access\?org=/);
});

test("credentials are rendered only when the server says access is currently allowed", () => {
  const pass = read("components/member-access-pass.tsx");
  assert.match(pass, /pass\.accessAllowed \? accessQrMatrix\(pass\.qrToken\) : \[\]/);
  assert.match(pass, /pass\.accessAllowed \? <><div/);
  assert.match(pass, /PIN and QR are hidden because access is not currently active/);
});

test("access route displays explicit retry and unavailable states instead of stale credentials", () => {
  const page = read("app/member-hub/access/page.tsx");
  const loading = read("app/member-hub/access/loading.tsx");
  assert.match(page, /PIN and QR are not shown/);
  assert.match(page, /will not display an old or unverified PIN or QR/);
  assert.match(read("components/member-access-venue-eligibility.tsx"), /Entry is always checked live at the venue/);
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /qrToken|pin/);
});

test("existing device access keeps its nonce replay, timestamp and attempt guards", () => {
  const migration = read("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql");
  const base = read("supabase/migrations/2026-12-03-member-import-and-access.sql");
  assert.match(migration, /abs\(extract\(epoch from\(now\(\)-p_presented_at\)\)\)>120/);
  assert.match(base, /unique\(device_id,request_nonce\)/);
  assert.match(migration, /request_nonce/);
  assert.match(migration, /recent_failures,0\)>=10/);
});

test("Akuvox response adapter maps only an authoritative allow decision to success", () => {
  assert.deepEqual(JSON.parse(akuvoxA02Response({ allowed: true, decision: "allow" })), { isvalid: true });
  assert.deepEqual(JSON.parse(akuvoxA02Response({ allowed: false, decision: "deny" })), { isvalid: false });
  assert.deepEqual(JSON.parse(akuvoxA02Response({ allowed: true, decision: "deny" })), { isvalid: false });
});
