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
