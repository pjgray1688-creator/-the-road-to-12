import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("components/club-shell.tsx", "utf8");
const shellCss = readFileSync("components/club-shell.module.css", "utf8");
const globals = readFileSync("app/globals.css", "utf8");
const dashboard = readFileSync("app/club/page.tsx", "utf8");

test("Club mobile menu uses one vertical link list, separate selectors, close and route-change handling", () => {
  assert.match(shell, /role="dialog" aria-modal="true"/);
  assert.match(shell, /aria-label="Close navigation"/);
  assert.match(shell, /window\.addEventListener\("keydown",handleMenuKey\)/);
  assert.match(shell, /event\.key==="Escape"/);
  assert.match(shell, /event\.shiftKey&&document\.activeElement===first/);
  assert.match(shell, /requestAnimationFrame\(\(\)=>menuButtonRef\.current\?\.focus\(\)\)/);
  assert.match(shell, /const menuVisible=mobileOpen&&menuPath===pathname/);
  assert.match(shell, /onClick=\{closeMenu\}/);
  assert.match(shell, /<section aria-label="Venue selector"><h2>Venue<\/h2>\{renderVenue\(true\)\}<\/section>/);
  assert.match(shellCss, /\.mobileLinks \{ display: grid; grid-template-columns: minmax\(0,1fr\)/);
  assert.match(shellCss, /\.mobileMenu \{ position: fixed;[^}]*height: 100dvh/);
  assert.match(shellCss, /safe-area-inset-top/);
  assert.match(shellCss, /safe-area-inset-bottom/);
});

test("Club navigation keeps role-based destinations and organisation-scoped venue selection", () => {
  assert.match(shell, /const operational = \["trainer", "gym_staff", "gym_admin", "owner"\]/);
  assert.match(shell, /const admin = \["gym_admin", "owner"\]/);
  assert.match(shell, /\[\["Classes", `\/club\/classes/);
  assert.match(shell, /\["Membership payments", `\/club\/membership-billing/);
  assert.match(shell, /org=\$\{encodeURIComponent\(organisation\.id\)\}/);
  assert.match(shell, /Choose operational venue/);
});

test("Club pages receive safe-area, clipped-heading and narrow-screen layout rules without changing workflows", () => {
  assert.match(globals, /\.club-page\{[^}]*padding-top:calc\(10px \+ env\(safe-area-inset-top\)\)/);
  assert.match(globals, /\.club-page \.page-header h1\{[^}]*line-height:1\.12/);
  assert.match(globals, /@media\(max-width:760px\)[\s\S]*body:has\(\.club-page\)\{[^}]*overflow-x:clip/);
  assert.match(globals, /\.club-page \.club-detail-row\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:5px\}/);
  assert.doesNotMatch(dashboard, /eyebrow="R12 CLUB · OPERATIONS"/);
  assert.match(dashboard, /ClubMemberOnboarding/);
  assert.match(dashboard, /ClubSectionNav/);
});
