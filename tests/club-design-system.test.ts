import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Club uses canonical R12 branding and constrained tenant context", () => {
  const shell = readFileSync("components/club-shell.tsx", "utf8");
  const globals = readFileSync("app/globals.css", "utf8");
  assert.match(shell, /BrandLockup/);
  assert.doesNotMatch(shell, />12</);
  assert.match(shell, /org=\$\{encodeURIComponent\(organisation\.id\)\}/);
  assert.match(globals, /--r12-purple/);
  assert.match(globals, /prefers-reduced-motion/);
});

test("unlinked customer rows are excluded from membership-specific filters", () => {
  const source = readFileSync("components/club-members-directory.tsx", "utf8");
  assert.match(source, /membershipFilter === "all"/);
  assert.match(source, /No R12 account linked/);
});

test("Club keeps management shell isolated from the member app", () => {
  const source = readFileSync("app/club/members/page.tsx", "utf8");
  assert.match(source, /ClubSectionNav/);
  assert.match(source, /AppNav/);
});
