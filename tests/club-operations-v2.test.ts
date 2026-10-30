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
  assert.match(shell, /tenantMark/);
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
  assert.match(shell, /\["trainer", "gym_staff", "gym_admin", "owner"\]\.includes\(role\)/);
  assert.match(shell, /paymentsAllowed \? \[\{ label: "Payments"/);
  assert.match(shell, /admin \? \[\{ label: "Management"/);
  assert.doesNotMatch(shell, /label: "Management"[^]*role === "member"/);
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

test("owner Club navigation exposes the consolidated operational sections", () => {
  const shell = read("components/club-shell.tsx");
  for (const label of ["Overview", "Members", "Payments", "Shop", "Classes & PT", "Operations", "Management"]) {
    assert.match(shell, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /club\/more/);
  assert.doesNotMatch(shell, /label: "Finance"/);
});

test("Club navigation maps lifecycle and administration routes to one primary section", () => {
  const shell = read("components/club-shell.tsx");
  assert.match(shell, /\["\/club\/check-in", "\/club\/access", "\/club\/reception", "\/club\/induction", "\/club\/checks", "\/club\/sunbeds"\]/);
  assert.doesNotMatch(shell, /pathname.startsWith\("\/club\/(locations|staff)\"\)/);
  assert.match(shell, /path\.startsWith\("\/club\/payments"\).*return "Payments"/);
  assert.match(shell, /return "Management"/);
  assert.match(shell, /link\.group === activeGroup/);
});

test("More and Members expose lower-frequency and lifecycle destinations", () => {
  const more = read("app/club/more/page.tsx");
  const members = read("app/club/members/page.tsx");
  assert.ok(more.includes("/club/locations"));
  assert.ok(more.includes("/club/staff"));
  assert.ok(more.includes("Manage venues and operational location settings"));
  assert.ok(more.includes("Manage staff access, Club roles and permissions"));
  assert.match(members, /ClubMembersDirectory/);
  assert.match(members, /ClubMemberOnboarding/);
  assert.doesNotMatch(members, /redirect\(`\/club/);
});

test("Overview and Payments expose operational drill-downs without duplicating systems", () => {
  const overview = read("app/club/page.tsx");
  const finance = read("app/club/payments/page.tsx");
  const shopTabs = read("components/club-shop-tabs.tsx");
  assert.doesNotMatch(overview, /ClubMembersDirectory/);
  assert.doesNotMatch(overview, /ClubMemberOnboarding/);
  assert.match(overview, /\/club\/members/);
  assert.match(overview, /Shop sale/);
  assert.match(overview, /Inductions/);
  assert.match(finance, /title=\"Payments\"/);
  assert.match(finance, /Transactions/);
  assert.match(finance, /FAILED &amp; OVERDUE/);
  assert.match(finance, /CASH VERIFICATION/);
  assert.match(finance, /club_order_items/);
  assert.doesNotMatch(shopTabs, />Cash<\/a>/);
});
