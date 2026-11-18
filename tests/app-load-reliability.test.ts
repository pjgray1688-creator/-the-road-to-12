import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyLoadFailure } from "../lib/club-load-state";

test("load failures distinguish stale sessions, denied permissions, network interruptions and unknown failures", () => {
  assert.equal(classifyLoadFailure({ code: "PGRST303", message: "JWT issued at future" }), "session");
  assert.equal(classifyLoadFailure({ code: "42501" }), "permission");
  assert.equal(classifyLoadFailure(new TypeError("fetch failed")), "network");
  assert.equal(classifyLoadFailure({ code: "XX000" }), "unavailable");
});

test("Club context reads are request-cached and Coach diary reuses the loaded context", () => {
  const context = readFileSync("lib/club-server-context.ts", "utf8");
  const repository = readFileSync("lib/supabase-club-repository.ts", "utf8");
  const diary = readFileSync("app/coach/diary/page.tsx", "utf8");
  assert.match(context, /listClubOrganisationContexts = cache\(loadClubOrganisationContexts\)/);
  assert.match(diary, /listClubOrganisationContexts\(supabase, user\.id\)/);
  assert.doesNotMatch(diary, /resolveClubOrganisationContext/);
  assert.match(diary, /Promise\.all\(\[[\s\S]*club_list_shared_schedule[\s\S]*club_list_shared_working_hours/);
  assert.match(repository, /slow Supabase request[\s\S]{0,120}operation, durationMs/);
});

test("load recovery is user-triggered and does not retry mutations", () => {
  const recovery = readFileSync("components/load-recovery.tsx", "utf8");
  assert.match(recovery, /router\.refresh\(\)/);
  assert.match(recovery, /kind !== "permission"/);
  assert.doesNotMatch(recovery, /setTimeout|setInterval|fetch\(/);
});

test("Coach session actions block duplicate submissions and retain one retry idempotency key", () => {
  const workspace = readFileSync("components/coach-workspace.tsx", "utf8");
  const builder = readFileSync("components/coach-programme-builder.tsx", "utf8");
  assert.match(workspace, /if \(!selected \|\| !day\.id \|\| startingSessionId\) return/);
  assert.match(workspace, /sessionKeys\.current\.get\(sessionKey\) \?\? crypto\.randomUUID\(\)/);
  assert.match(workspace, /if \(!session \|\| savingSession\) return/);
  assert.match(builder, /disabled=\{runningSessionId === selectedSession\.id\}/);
});

test("station recovery checks the signed registration before clearing same-scope cookies", () => {
  const route = readFileSync("app/api/club/station/recover/route.ts", "utf8");
  assert.match(route, /eq\("token_hash", tokenHash\)/);
  assert.match(route, /if \(!isDisabled\).*\/club\/lock/);
  assert.match(route, /if \(error\)[\s\S]*status: 503/);
  assert.match(route, /response\.cookies\.set\(CLUB_STATION_COOKIE[\s\S]*response\.cookies\.set\(CLUB_STATION_USER_COOKIE/);
});
