import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { safeInternalReturnTo } from "../lib/auth-return";

test("auth return paths preserve internal Club URLs and reject open redirects", () => {
  assert.equal(safeInternalReturnTo("/club?org=fa44592a-1593-4ad3-a621-63a4a4bcbceb"), "/club?org=fa44592a-1593-4ad3-a621-63a4a4bcbceb");
  assert.equal(safeInternalReturnTo("/club/shop?org=o&view=stock"), "/club/shop?org=o&view=stock");
  assert.equal(safeInternalReturnTo("https://evil.example/"), undefined);
  assert.equal(safeInternalReturnTo("//evil.example/"), undefined);
  assert.equal(safeInternalReturnTo("javascript:alert(1)"), undefined);
});

test("account sign-in consumes a validated app destination and performs one full navigation", () => {
  const source = readFileSync("app/account/page.tsx", "utf8");
  assert.match(source, /authDestination/);
  assert.match(source, /window\.location\.replace\(context\.next\)/);
  assert.match(source, /if \(params\.get\("next"\) && !glowAccount\)/);
});
