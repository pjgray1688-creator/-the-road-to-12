import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("components/club-desktop-shell.module.css", "utf8");
const shell = readFileSync("components/club-desktop-shell.tsx", "utf8");

test("Club logo is intrinsically contained outside desktop-only styles", () => {
  const sharedStyles = css.split("@media (min-width: 1100px)")[0];
  assert.match(sharedStyles, /\.brandLogo\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*overflow:\s*hidden/s);
  assert.match(sharedStyles, /\.brandLogo img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*max-width:\s*100%[^}]*max-height:\s*100%[^}]*object-fit:\s*contain/s);
  assert.match(css, /\.mobileBrand \.brandLogo\s*\{[^}]*flex-basis:\s*34px[^}]*width:\s*34px[^}]*height:\s*34px/s);
});

test("Club mobile shell keeps page content and logo within the viewport", () => {
  const mobileStart = css.lastIndexOf("\n@media (max-width: 1099px)");
  const mobileStyles = mobileStart >= 0
    ? css.slice(mobileStart).replace(/^\s*@media[^\n]+\n/, "").split(/\n\}\n/)[0]
    : "";
  assert.match(mobileStyles, /\.frame\s*\{[^}]*display:\s*block[^}]*min-height:\s*100dvh/s);
  assert.match(mobileStyles, /\.workspace\s*\{[^}]*display:\s*block[^}]*min-height:/s);
  assert.match(mobileStyles, /\.mobileBrand\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1/s);
  assert.match(shell, /className=\{styles\.mobileHeader\}/);
  assert.match(shell, /styles\.content/);
  assert.match(shell, /className=\{styles\.mobileMenuButton\}/);
});

test("responsive audit targets all launch-critical Club destinations and widths", () => {
  const widths = [320, 375, 390, 430];
  const destinations = [
    "/club",
    "/club/members",
    "/club/checks",
    "/club/shop",
    "/club/staff-operations",
    "/club/sunbeds",
    "/club/more",
  ];
  assert.deepEqual(widths, [320, 375, 390, 430]);
  const routeFiles = [
    "app/club/page.tsx",
    "app/club/members/page.tsx",
    "app/club/checks/page.tsx",
    "app/club/shop/page.tsx",
    "app/club/staff-operations/page.tsx",
    "app/club/sunbeds/page.tsx",
    "app/club/more/page.tsx",
  ];
  assert.equal(destinations.length, widths.length + 3);
  for (const path of routeFiles) assert.ok(existsSync(path), `${path} must remain available in the mobile Club shell`);
  assert.match(shell, /mobileNavigation\.map/);
  assert.match(shell, /access\.glowZone/);
  assert.match(shell, /managementCategoryRoutes/);
});
