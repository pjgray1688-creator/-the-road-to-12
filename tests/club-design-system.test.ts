import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Club uses canonical R12 branding and constrained tenant context", () => {
  const shell = readFileSync("components/club-shell.tsx", "utf8");
  const desktop = readFileSync("components/club-desktop-shell.tsx", "utf8");
  const globals = readFileSync("app/globals.css", "utf8");
  assert.match(desktop, /branding\?\.displayName/);
  assert.match(desktop, /R12 Club/);
  assert.match(desktop, /org=\$\{org\}/);
  assert.doesNotMatch(shell, />12</);
  assert.match(globals, /--r12-purple/);
  assert.match(globals, /prefers-reduced-motion/);
});

test("unlinked customer rows are excluded from membership-specific filters", () => {
  const source = readFileSync("components/club-members-directory.tsx", "utf8");
  assert.match(source, /statusFilter/);
  assert.match(source, /\.\.\.customers\.map\(customer/);
  assert.match(source, /imported: true/);
  assert.match(source, /membershipStatus/);
});

test("Club overview owns the management shell separately from the member app", () => {
  const overview = readFileSync("app/club/page.tsx", "utf8");
  const membersRoute = readFileSync("app/club/members/page.tsx", "utf8");
  const layout = readFileSync("app/club/layout.tsx", "utf8");
  assert.match(layout, /ClubDesktopShell/);
  assert.doesNotMatch(overview, /AppNav/);
  assert.match(membersRoute, /resolveClubOperationalContext/);
});
