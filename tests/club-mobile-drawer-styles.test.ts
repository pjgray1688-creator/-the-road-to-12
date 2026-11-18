import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("native Club drawer has explicit mobile link, row and disclosure styling", () => {
  const css = read("components/club-desktop-shell.module.css");
  const start = css.lastIndexOf("@media (max-width: 1099px) {");
  const end = css.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, "mobile drawer media block exists");
  const mobile = css.slice(start, end);
  assert.match(mobile, /\.navigation\s*\{[^}]*display:grid/);
  assert.match(mobile, /\.navigation > a,\.groupRow > a\s*\{[^}]*display:flex[^}]*color:[^}]*text-decoration:none/);
  assert.match(mobile, /\.groupRow > button\s*\{[^}]*appearance:none[^}]*background:transparent[^}]*color:/);
  assert.match(mobile, /\.subNavigation > a,\.operationalSubNavigation > a\s*\{[^}]*display:flex[^}]*color:[^}]*text-decoration:none/);
  assert.match(mobile, /min-height:48px/);
  assert.match(mobile, /width:44px;\s*height:44px;\s*min-height:44px/);
});

test("Club native menu uses the shared permission-filtered sidebar and Member tabs retain explicit styling", () => {
  const clubShell = read("components/club-desktop-shell.tsx");
  const memberNav = read("components/app-nav.tsx");
  const memberStyles = read("app/training-polish.css");
  assert.match(clubShell, /import styles from "\.\/club-desktop-shell\.module\.css"/);
  assert.match(clubShell, /className=\{styles\.sidebar\}/);
  assert.match(clubShell, /mobileNavigation\.map/);
  assert.match(clubShell, /access\.management \?/);
  assert.match(clubShell, /access\.dailyChecks \?/);
  assert.match(clubShell, /<Link[\s\S]*className=\{activePath\(pathname, item\) \? styles\.active/);
  assert.match(memberNav, /className=\{selected \? "selected" : ""\}/);
  assert.match(memberStyles, /\.app-nav a \{[^}]*display: grid[^}]*color: var\(--text-tertiary\)[^}]*text-decoration: none/s);
});
