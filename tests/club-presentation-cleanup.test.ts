import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Club overview uses tenant artwork without changing the Member app", () => {
  const overview = readFileSync(new URL("../app/club/page.tsx", import.meta.url), "utf8");
  const memberLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(overview, /madhouse-club-wide\.png/);
  assert.match(overview, /generateMetadata/);
  assert.doesNotMatch(memberLayout, /madhouse-club-wide/);
});

test("Club shell constrains identity and preserves venue navigation", () => {
  const shell = readFileSync(new URL("../components/club-shell.module.css", import.meta.url), "utf8");
  const nav = readFileSync(new URL("../components/club-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /minmax\(145px,190px\)/);
  assert.match(nav, /Choose operational venue/);
});

test("Members uses person terminology and Reception keeps compact result styling", () => {
  const members = readFileSync(new URL("../app/club/members/page.tsx", import.meta.url), "utf8");
  const receptionStyles = readFileSync(new URL("../components/club-reception.module.css", import.meta.url), "utf8");
  assert.match(members, /title="Members"/);
  assert.match(receptionStyles, /min-height:54px/);
});
