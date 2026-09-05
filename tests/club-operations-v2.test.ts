import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(shell, /BrandLockup compact/);
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
  const shell = read("components/club-shell.tsx");
  assert.match(shell, /role === "trainer"/);
  assert.match(shell, /\["Classes"/);
  assert.doesNotMatch(shell, /role === "trainer"[^]*Locations/);
  assert.doesNotMatch(shell, /role === "member"[^]*Members/);
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
  assert.match(nav, /Today/);
});

test("Club venue context is explicit, role-aware and preserved in navigation", () => {
  const shell = read("components/club-shell.tsx");
  assert.match(shell, /Choose operational venue/);
  assert.match(shell, /All locations/);
  assert.match(shell, /location=/);
  assert.match(shell, /locations\.filter\(location => location\.active\)/);
  assert.match(shell, /More/);
});

test("owner Club navigation exposes the consolidated operational sections", () => {
  const shell = read("components/club-shell.tsx");
  for (const label of ["Overview", "Reception", "Members", "Shop", "Classes", "Services", "Finance", "More"]) {
    assert.match(shell, new RegExp(`\\[\\"${label}\\"`));
  }
  assert.doesNotMatch(shell, /\[\"Payments\"/);
  assert.doesNotMatch(shell, /\[\"Locations\"/);
  assert.doesNotMatch(shell, /\[\"Inductions?\"/);
  assert.doesNotMatch(shell, /\[\"Staff\"/);
  assert.match(shell, /club\/more/);
});

test("Club navigation maps lifecycle and administration routes to one primary section", () => {
  const shell = read("components/club-shell.tsx");
  assert.ok(shell.includes('pathname.startsWith("/club/induction")') && shell.includes('? "Members"'));
  assert.ok(shell.includes('pathname.startsWith("/club/locations")') && shell.includes('? "More"'));
  assert.ok(shell.includes('pathname.startsWith("/club/staff")') && shell.includes('? "More"'));
  assert.ok(shell.includes('pathname.startsWith("/club/payments")') && shell.includes('? "Finance"'));
  assert.ok(shell.includes("Boolean(link && link[0] === activeSection)"));
});

test("More and Members expose lower-frequency and lifecycle destinations", () => {
  const more = read("app/club/more/page.tsx");
  const members = read("app/club/members/page.tsx");
  assert.ok(more.includes("/club/locations"));
  assert.ok(more.includes("/club/staff"));
  assert.ok(more.includes("Manage venues and operational location settings"));
  assert.ok(more.includes("Manage staff access and Club roles"));
  assert.ok(members.includes("/club/induction"));
});

test("Overview and Finance expose operational drill-downs without duplicating systems", () => {
  const overview = read("app/club/page.tsx");
  const finance = read("app/club/payments/page.tsx");
  const shopTabs = read("components/club-shop-tabs.tsx");
  assert.match(overview, /ClubMembersDirectory/);
  assert.match(overview, /New membership \/ members/);
  assert.match(overview, /Shop sale/);
  assert.match(overview, /PT and services/);
  assert.match(overview, /view=cash/);
  assert.match(finance, /title=\"Finance\"/);
  assert.match(finance, /Transactions/);
  assert.match(finance, /Membership payments/);
  assert.match(finance, /Cash verification/);
  assert.match(finance, /club_order_items/);
  assert.match(finance, /Reports/);
  assert.doesNotMatch(shopTabs, />Cash<\/a>/);
});
