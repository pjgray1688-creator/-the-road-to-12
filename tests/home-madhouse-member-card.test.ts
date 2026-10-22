import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { homeMemberAreaCard } from "../lib/home-member-area";

const read = (path: string) => readFileSync(path, "utf8");

test("linked Madhouse Home card uses the canonical gym name, real asset and scoped shortcuts", () => {
  const organisation = { id: "gym/id", name: "R12 Performance", slug: "madhouse-gym" };
  const card = homeMemberAreaCard(organisation);
  assert.equal(card.name, "Madhouse Gym");
  assert.equal(card.href, "/member-hub");
  assert.deepEqual(card.shortcuts.map(item => item.label), ["Classes", "Gym Access", "Shop"]);
  assert.deepEqual(card.shortcuts.map(item => item.icon), ["calendar", "access", "bag"]);
  assert.deepEqual(card.shortcuts.map(item => item.href), [
    "/member-hub/classes?org=gym%2Fid",
    "/member-hub#membership-access-gym%2Fid",
    "/member-hub/shop?org=gym%2Fid",
  ]);
  assert.ok(existsSync("public/club-branding/madhouse-rotherham-wall-logo.jpg"));
  const component = read("components/dashboard-foundation.tsx");
  assert.match(component, /Madhouse Gym/);
  assert.match(component, /madhouse-rotherham-wall-logo\.jpg/);
  assert.match(component, /Rotherham, with its wall logo/);
  assert.doesNotMatch(component, /R12 Performance/);
  assert.match(component, /aria-label=\{`Open \$\{card\.name\} Member Area`\}/);
});

test("unlinked members see no fabricated Home gym card and unknown gyms receive no unsupported shortcuts", () => {
  const dashboard = read("components/dashboard-foundation.tsx");
  assert.match(dashboard, /memberOrganisations\.length > 0 && <section className="card dashboard member-gym-shortcut home-member-area"/);
  assert.equal(homeMemberAreaCard({ id: "other-org", name: "Other Gym", slug: "other-gym" }).shortcuts.length, 0);
  assert.equal(homeMemberAreaCard({ id: "madhouse", name: "Madhouse Gym", slug: "madhouse-gym" }).shortcuts.length, 3);
});

test("Gym Access shortcut targets the existing membership and access section without changing access authority", () => {
  const memberHub = read("components/member-hub.tsx");
  assert.match(memberHub, /id=\{`membership-access-\$\{item\.organisation\.id\}`\}/);
  assert.match(memberHub, /MEMBERSHIP &amp; ACCESS/);
  assert.match(read("components/member-access-pass.tsx"), /pass\.accessAllowed/);
  assert.match(read("app/member-hub/page.tsx"), /club_get_my_access_pass/);
});

test("Madhouse shortcuts keep member routes organisation-scoped and use compact mobile tiles", () => {
  const model = read("lib/home-member-area.ts");
  const css = read("app/globals.css");
  assert.match(model, /\/member-hub\/classes\?org=/);
  assert.match(model, /\/member-hub\/shop\?org=/);
  assert.match(model, /\/member-hub#membership-access-/);
  assert.match(css, /\.member-gym-shortcuts\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.member-gym-photo[^}]*object-fit:cover/);
  assert.match(css, /@media\(max-width:360px\)\{\.member-gym-shortcut\.home-member-area/);
});
