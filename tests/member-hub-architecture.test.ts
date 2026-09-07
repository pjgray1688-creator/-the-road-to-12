import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Account enters a dedicated member hub rather than Club operations", () => {
  const account = readFileSync("app/account/page.tsx", "utf8");
  const hub = readFileSync("app/member-hub/page.tsx", "utf8");
  assert.match(account, /href="\/member-hub"/);
  assert.match(hub, /club_list_my_memberships/);
  assert.doesNotMatch(hub, /listMemberSummaries|ClubMembersDirectory|ClubSectionNav/);
});

test("member hub resolves memberships from the authenticated user and keeps operator routes separate", () => {
  const migration = readFileSync("supabase/migrations/2026-09-07-club-member-hub-boundary.sql", "utf8");
  const hub = readFileSync("components/member-hub.tsx", "utf8");
  assert.match(migration, /h\.user_id = auth\.uid\(\)/);
  assert.match(migration, /revoke all on function public\.club_list_my_memberships/);
  assert.match(hub, /member-hub\/classes/);
  assert.match(hub, /member-hub\/shop/);
  assert.doesNotMatch(hub, /staff|reception|Club operations/i);
});

test("member hub keeps unsupported credentials and verification truthful", () => {
  const hub = readFileSync("components/member-hub.tsx", "utf8");
  const link = readFileSync("app/member-hub/link/page.tsx", "utf8");
  assert.match(hub, /Digital access/);
  assert.match(link, /Email verification is not configured yet/);
  assert.doesNotMatch(link, /window\.(alert|prompt|confirm)/);
});

test("Today uses member-safe gym context and keeps recovery management in Account", () => {
  const today = readFileSync("components/dashboard-foundation.tsx", "utf8");
  const account = readFileSync("app/account/page.tsx", "utf8");
  assert.match(today, /\/api\/member-hub/);
  assert.match(today, /href="\/member-hub"/);
  assert.doesNotMatch(today, /whoop\/disconnect/);
  assert.match(account, /whoop\/disconnect/);
});

test("Member shop exposes self-service scanning without operator controls", () => {
  const shop = readFileSync("components/club-shop.tsx", "utf8");
  assert.match(shop, /props\.staff \? "club-shop-workspace" : "member-shop-workspace"/);
  assert.match(shop, /MEMBER SHOP/);
  const memberBranch = shop.split("if (!staff)")[1]?.split("return <div className=\{styles.shop\}")[0] ?? "";
  assert.doesNotMatch(memberBranch, /SHOP OPERATIONS|Cash to verify|RECEPTION/);
  assert.match(shop, /aria-label=\"Product barcode\"/);
  assert.match(shop, /normalizeBarcode\(candidate\.barcode\)/);
});
