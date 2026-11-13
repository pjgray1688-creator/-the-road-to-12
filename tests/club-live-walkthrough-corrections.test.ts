import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Management label navigates home and its separate chevron controls exactly five categories", () => {
  const shell = read("components/club-desktop-shell.tsx");
  const expected = ["Finance & Payments", "Staff & Rota", "Membership Administration", "Shop Administration", "Venues & Settings"];
  const routes = shell.slice(shell.indexOf("const managementCategoryRoutes"), shell.indexOf("const venueOptions"));
  assert.equal((routes.match(/\["[^\]]+", "[a-z]+"\]/g) ?? []).length, 5);
  for (const label of expected) assert.ok(routes.includes(label));
  assert.match(shell, /<Link href=\{`\/club\/more\$\{q\}`\}[^>]*title="Management"/);
  assert.match(shell, /aria-label=\{`\$\{managementOpen \? "Collapse" : "Expand"\} Management links`\}/);
  assert.doesNotMatch(routes, /Management home/);
  const legacy = read("components/club-shell.tsx");
  for (const section of ["section=finance", "section=staff", "section=membership", "section=shop", "section=venues"]) assert.ok(legacy.includes(section));
});

test("Door access is not placed under Members or in the operational sidebar; the admin route omits sunbed hours", () => {
  const shell = read("components/club-desktop-shell.tsx");
  const links = shell.slice(shell.indexOf("const links = useMemo"), shell.indexOf("if (!operational || !selected)"));
  assert.doesNotMatch(links, /Door Access/);
  assert.match(shell, /Door access administration/);
  const oldNav = read("components/club-shell.tsx");
  assert.doesNotMatch(oldNav, /label: "Door access"/);
  const accessPage = read("app/club/access/page.tsx");
  assert.doesNotMatch(accessPage, /club_location_service_hours|GlowZoneOpeningHours/);
});

test("Rota date navigation retains selected scope and venue, while server validates venue IDs", () => {
  const calendar = read("components/club-schedule-calendar.tsx");
  const page = read("app/club/schedule/page.tsx");
  assert.match(calendar, /params\.set\("view", rotaView\)/);
  assert.match(calendar, /params\.set\("location", locationFilter\)/);
  assert.match(page, /locations\.some\(location => location\.id === params\.location && location\.active\)/);
  assert.match(page, /p_location_id: selectedLocationId/);
  assert.match(page, /p_staff_user_id: scope === "team" \? null : user\.id/);
});

test("staff display names prefer profile and linked identity over email usernames", () => {
  const layout = read("app/club/layout.tsx");
  const resolver = read("lib/club-instructor-name.ts");
  assert.match(layout, /listLinkedInstructorIdentities/);
  assert.match(layout, /profileName\|\|profile\.data\?\.display_name\|\|linkedName/);
  assert.doesNotMatch(layout, /user\?\.email\?\.split\("@"\)/);
  assert.match(resolver, /identities\.find\(item => item\.userId === hostUserId\)/);
  assert.doesNotMatch(resolver, /firstName|normalizedName/);
});

test("promotions page keeps shop and membership offers separate and reports failed reads as unknown", () => {
  const page = read("app/club/promotions/page.tsx");
  const component = read("components/club-promotions.tsx");
  assert.match(page, /from\("club_promotions"\)/);
  assert.match(page, /from\("club_membership_joining_fee_promotions"\)/);
  assert.match(page, /shopOffersUnavailable=\{Boolean\(shopResult\.error\)\}/);
  assert.match(page, /membershipOffersUnavailable=\{Boolean\(membershipResult\.error\)\}/);
  assert.match(component, /Membership offers could not be loaded\. Their status is unknown\./);
  assert.match(component, /separate membership promotion system/);
});

test("Glow age confirmation remains explicit and management view does not offer operational minute sales", () => {
  const operations = read("components/club-sunbed-operations.tsx");
  const page = read("app/club/sunbeds/page.tsx");
  assert.match(operations, /onChange=\{event => setAdultConfirmed\(event\.target\.checked\)\}/);
  assert.match(operations, /onClick=\{verify\}/);
  assert.match(operations, /!managementMode \? \(/);
  assert.match(operations, /!managementMode \? <div className=\{styles\.subsection\}>\s*<h3 className=\{styles\.sectionTitle\}>Sell minutes/);
  assert.ok(page.includes("{!managementView?<GlowZoneReceptionScanner"));
  assert.match(page, /managementMode=\{managementView\}/);
  assert.match(page, /R12_GLOW_REPORT_READ_FAILED/);
});

test("staff membership form is capability gated and placed before the paginated directory", () => {
  const page = read("app/club/members/page.tsx");
  assert.match(page, /hasCapability\(context\.organisation\.id, user\.id, "memberships\.assign"\)/);
  assert.ok(page.indexOf("{canAssign ? <Surface><ClubMemberOnboarding") < page.indexOf("<ClubMembersDirectory"));
});

test("Website Shop management uses the approved local apparel image manifest assets", () => {
  const page = read("app/club/website-shop/page.tsx");
  const paths = [...page.matchAll(/"(\/madhouse-apparel\/[^\"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 27);
  assert.ok(paths.every(path => existsSync(new URL(`../public${path}`, import.meta.url))));
  assert.doesNotMatch(page, /"\/apparel\//);
  assert.doesNotMatch(page, /Return to Products & Pricing/);
});

test("Finance marks Glow Zone totals unavailable instead of silently presenting them as complete", () => {
  const page = read("app/club/payments/page.tsx");
  assert.match(page, /R12_FINANCE_READ_FAILED/);
  assert.match(page, /Glow Zone excluded \(report unavailable\)/);
  assert.match(page, /Finance data unavailable/);
});
