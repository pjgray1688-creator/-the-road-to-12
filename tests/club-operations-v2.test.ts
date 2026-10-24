import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubNavigationLinks, activeClubNavigationPath } from "../lib/club-navigation";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Club operations keeps organisation context explicit and switchable", () => {
  const context = read("lib/club-server-context.ts");
  const shell = read("components/club-shell.tsx");
  assert.match(context, /contexts\.length === 1/);
  assert.match(context, /organisationId \? contexts\.find/);
  assert.doesNotMatch(context, /contexts\[0\].*organisationId/);
  assert.match(shell, /Choose organisation/);
  assert.match(shell, /router\.push\(`\/club\?org=/);
  assert.match(shell, /contexts\.length > 1/);
  assert.doesNotMatch(shell, /BrandLockup|CLUB OPERATIONS/);
  assert.doesNotMatch(shell, />12<|className=\{styles\.mark\}/);
});

test("Club overview resolves its repository exactly once through the organisation context", () => {
  const overview = read("app/club/page.tsx");
  assert.doesNotMatch(overview, /clubRepository\(supabase\)/);
  assert.match(overview, /listClubOrganisationContexts\(supabase, user\.id\)/);
});

test("Locations management is protected at the route boundary", () => {
  const locations = read("app/club/locations/page.tsx");
  assert.match(locations, /isClubStaffRole\(context\.role\)/);
});

test("Club navigation keeps management areas away from member and trainer roles", () => {
  for (const role of ["member", "guest", "trainer", "gym_staff"] as const) {
    const labels = clubNavigationLinks(role, "org").map(link => link.label);
    for (const restricted of ["Finance", "Staff", "Locations", "Shared stations"]) assert.ok(!labels.includes(restricted));
  }
});

test("Club V2 surfaces are role-aware and organisation-scoped", () => {
  const overview = read("app/club/page.tsx");
  const directory = read("components/club-members-directory.tsx");
  const locations = read("app/club/locations/page.tsx");
  assert.match(overview, /NEEDS ATTENTION/);
  assert.match(overview, /cash .*need verification/);
  assert.match(overview, /No fake|No upcoming classes scheduled/);
  assert.match(directory, /Search by name or email/);
  assert.match(directory, /Filter access/);
  assert.match(directory, /Filter membership/);
  assert.match(directory, /member\.userId/);
  assert.match(locations, /resolveClubOperationalContext/);
  assert.match(locations, /active sites|Active sites/);
});

test("member profile presents operational language without narrowing home-gym access", () => {
  const profile = read("app/club/members/[userId]/page.tsx");
  assert.match(profile, /preference only/);
  assert.match(profile, /All current and future locations/);
  assert.match(profile, /Gym Balance/);
  assert.match(profile, /Awaiting cash verification/);
  assert.doesNotMatch(profile, /entitlement grant|RPC/);
});

test("induction schema absence is contained at the repository boundary", () => {
  const repository = read("lib/supabase-club-repository.ts");
  assert.match(repository, /induction is not installed yet; continuing without it/);
  assert.match(repository, /operation === \"get_member_induction\"/);
});

test("protected Club writes remain server/repository actions", () => {
  for (const path of ["components/club-shop.tsx", "components/club-staff-checkout.tsx", "components/club-classes.tsx"]) {
    assert.doesNotMatch(read(path), /\.from\(['"]club_/);
  }
});

test("member navigation is not rendered inside Club while remaining app-scoped", () => {
  const nav = read("components/app-nav.tsx");
  assert.match(nav, /pathname\.startsWith\("\/club"\)/);
  assert.match(nav, /label: "Home"/);
  assert.doesNotMatch(nav, /href: "\/club", label: "Club"/);
});

test("Club venue context is explicit, role-aware and preserved in navigation", () => {
  const shell = read("components/club-shell.tsx");
  assert.match(shell, /Choose operational venue/);
  assert.match(shell, /All locations/);
  assert.match(shell, /location=/);
  assert.match(shell, /locations\.filter\(location => location\.active\)/);
  assert.doesNotMatch(shell, /\["More"/);
});

test("owner Club navigation exposes consolidated operations and administration", () => {
  const labels = clubNavigationLinks("owner", "org").map(link => link.label);
  for (const name of ["Reception", "Daily checks", "Members", "Shop", "Glow Zone", "Classes", "Staff & PT schedule", "Inductions", "Finance", "Staff", "Locations"]) assert.ok(labels.includes(name));
});

test("Club navigation maps product details to Shop and preserves lifecycle sections", () => {
  assert.equal(activeClubNavigationPath("/club/products/123"), "/club/shop");
  assert.equal(activeClubNavigationPath("/club/induction"), "/club/induction");
  assert.equal(activeClubNavigationPath("/club/payments"), "/club/payments");
});

test("More and the organisation Menu share role-filtered navigation", () => {
  assert.match(read("app/club/more/page.tsx"), /ClubMenuLinks/);
  assert.match(read("components/club-shell.tsx"), /ClubMenuLinks/);
  assert.match(read("app/club/members/page.tsx"), /redirect/);
});

test("Overview and Finance expose operational drill-downs without duplicating systems", () => {
  const overview = read("app/club/page.tsx");
  const finance = read("app/club/payments/page.tsx");
  const shopTabs = read("components/club-shop-tabs.tsx");
  assert.match(overview, /ClubMembersDirectory/);
  assert.match(overview, /MEMBER SEARCH/);
  assert.match(overview, /Shop sale/);
  assert.match(overview, /Inductions/);
  assert.match(overview, /<strong>Staff<\/strong>/);
  assert.match(overview, /ClubMemberOnboarding/);
  assert.match(finance, /title=\"Finance\"/);
  assert.match(finance, /Transactions/);
  assert.match(finance, /Membership payments/);
  assert.match(finance, /Cash verification/);
  assert.match(finance, /club_order_items/);
  assert.match(finance, /Reports/);
  assert.doesNotMatch(shopTabs, />Cash<\/a>/);
});
