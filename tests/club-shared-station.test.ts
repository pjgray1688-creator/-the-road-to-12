import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { signClubStationSession, verifyClubStationSession } from "@/lib/club-station";

const migration=readFileSync("supabase/migrations/2026-12-28-club-shared-station-pin-auth.sql","utf8");
const manifest=readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt","utf8");
const harness=readFileSync("scripts/validate-coach-nutrition-reconciliation-postgres.sh","utf8");
const workflow=readFileSync(".github/workflows/validate-migrations-postgres.yml","utf8");

test("shared-station migration is additive, manifest-ordered and exercised by the disposable PostgreSQL harness",()=>{
  assert.match(migration,/create table if not exists public\.club_shared_stations/);
  assert.match(migration,/create table if not exists public\.club_station_staff_pins/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.club_shared_stations, public\.club_station_staff_pins from public, anon, authenticated/);
  assert.ok(manifest.indexOf("2026-12-27-staff-claim-context.sql")<manifest.indexOf("2026-12-28-club-shared-station-pin-auth.sql"));
  assert.match(harness,/--file=supabase\/migrations\/2026-12-28-club-shared-station-pin-auth\.sql/);
  const harnessOrder = [
    "2026-12-03-member-import-and-access.sql",
    "2026-12-04-member-pin-qr-access-pass.sql",
    "2026-12-07-club-pos-sellable-units-and-pt-packages.sql",
    "2026-12-23-club-attendance-station-leaderboard.sql",
    "2026-12-28-club-shared-station-pin-auth.sql",
  ].map(file => harness.indexOf(`--file=supabase/migrations/${file}`));
  assert.ok(harnessOrder.every(position => position >= 0));
  assert.deepEqual(harnessOrder, [...harnessOrder].sort((a,b)=>a-b));
});

test("staff PIN is bcrypt-hashed, private, recently reauthenticated and independently rate-limited",()=>{
  assert.match(migration,/extensions\.crypt\(p_pin,extensions\.gen_salt\('bf',12\)\)/);
  assert.match(migration,/auth_time[\s\S]{0,200}extract\(epoch from now\(\)\)::bigint-300/);
  assert.match(migration,/failed_attempts between 0 and 5/);
  assert.match(migration,/v_count>=5 then now\(\)\+interval '5 minutes'/);
  assert.match(migration,/revoke all on public\.club_shared_stations, public\.club_station_staff_pins from public, anon, authenticated/);
  assert.match(migration,/club_station_verify_pin\(uuid,text,uuid,text\) to service_role/);
  assert.doesNotMatch(migration,/grant[^;]+club_station_verify_pin[^;]+authenticated/i);
});

test("station chooser lists only active staff with an enabled PIN and omits email addresses",()=>{
  const roster=migration.slice(migration.indexOf("create or replace function public.club_station_list_staff"),migration.indexOf("create or replace function public.club_station_verify_pin"));
  assert.match(roster,/join public\.club_station_staff_pins pin[\s\S]*pin\.enabled/);
  assert.match(roster,/m\.active/);
  assert.doesNotMatch(roster,/returns table\([^)]*email/i);
  assert.doesNotMatch(roster,/select[^;]*u\.email/i);
});

test("PostgreSQL CI installs the real pgcrypto extension in Supabase's extensions schema",()=>{
  assert.match(workflow,/create schema if not exists extensions;\s*create extension if not exists pgcrypto with schema extensions;/);
  assert.match(migration,/extensions\.crypt\(p_pin,extensions\.gen_salt\('bf',12\)\)/);
});

test("PIN unlock verifies a named staff identity then establishes a fresh Supabase session",()=>{
  const unlock=readFileSync("app/api/club/station/unlock/route.ts","utf8");
  const roster=readFileSync("app/api/club/station/roster/route.ts","utf8");
  assert.match(unlock,/signOut\(\{ scope: "local" \}\)/);
  assert.match(unlock,/club_station_verify_pin/);
  assert.match(unlock,/generateLink\(\{ type: "magiclink", email \}\)/);
  assert.match(unlock,/verifyOtp\(\{ token_hash: tokenHash, type: "magiclink" \}\)/);
  assert.match(unlock,/auth\.data\.user\?\.id !== userId/);
  assert.match(roster,/Cache-Control.*no-store/);
  assert.match(roster,/firstName: row\.first_name/);
  assert.doesNotMatch(roster,/email:/);
});

test("locked station gates direct Club paths and the inactivity timer ignores background polling",()=>{
  const proxy=readFileSync("proxy.ts","utf8");
  const timeout=readFileSync("components/club-station-lock.tsx","utf8").split("export function ClubStationTimeout")[1]??"";
  assert.match(proxy,/verifyClubStationSession/);
  assert.match(proxy,/url\.pathname = "\/club\/lock"/);
  assert.match(timeout,/pointerdown[\s\S]*keydown[\s\S]*touchstart[\s\S]*click/);
  assert.doesNotMatch(timeout,/setInterval|visibilitychange/);
  assert.match(timeout,/api\/club\/station\/activity/);
  assert.match(timeout,/pageshow/);
  assert.match(readFileSync("app/api/club/station/lock/route.ts","utf8"),/signOut\(\{ scope: "local" \}\)/);
});

test("scanner/access decision RPC remains separate from Club PIN/session code",()=>{
  const scan=readFileSync("app/club/access/actions.ts","utf8");
  assert.match(scan,/club_checkin_station_scan/);
  assert.doesNotMatch(scan,/club_station_verify_pin|station_staff_pins/);
});

test("Club identity menu and account stay in the Club shell without member navigation",()=>{
  const layout=readFileSync("app/club/layout.tsx","utf8");
  const menu=readFileSync("components/club-identity-control.tsx","utf8");
  const account=readFileSync("app/club/account/page.tsx","utf8");
  for(const action of ["Lock Club","Switch staff","Account","Sign out"])assert.ok(menu.includes(action));
  assert.match(layout,/ClubIdentityControl/);
  assert.match(account,/ClubPinSettings/);
  assert.doesNotMatch(account,/AppNav/);
});

test("station HMAC binds the exact user and station and expires after the configured idle timeout",()=>{
  const previous=process.env.R12_CLUB_STATION_SESSION_SECRET;
  process.env.R12_CLUB_STATION_SESSION_SECRET="a-secure-test-secret-with-at-least-32-bytes";
  try {
    const value=signClubStationSession("user-a","station-1",1000);
    assert.equal(verifyClubStationSession(value,"user-a","station-1",1001),true);
    assert.equal(verifyClubStationSession(value,"user-b","station-1",1001),false);
    assert.equal(verifyClubStationSession(value,"user-a","station-2",1001),false);
    assert.equal(verifyClubStationSession(value,"user-a","station-1",1000+5*60+1),false);
  } finally { if(previous===undefined)delete process.env.R12_CLUB_STATION_SESSION_SECRET;else process.env.R12_CLUB_STATION_SESSION_SECRET=previous; }
});

test("R12 favicon, Apple icon, product manifests and product titles resolve to existing assets",()=>{
  const root=readFileSync("app/layout.tsx","utf8");
  const member=readFileSync("app/manifest.ts","utf8");
  const club=readFileSync("app/club/manifest.ts","utf8");
  const coach=readFileSync("app/coach/layout.tsx","utf8");
  const iconSvg=readFileSync("public/r12-app-assets/icon.svg","utf8");
  const serviceWorker=readFileSync("public/sw.js","utf8");
  assert.match(root,/r12-app-assets\/favicon\.ico/);assert.match(root,/r12-app-assets\/apple-touch-icon\.png/);
  assert.match(member,/r12-app-assets\/icon-192\.png/);assert.match(club,/r12-app-assets\/club-icon-192\.png/);assert.match(coach,/R12 Coach/);
  assert.match(iconSvg,/<tspan fill="#f7f5ff">R<\/tspan><tspan fill="#9b62ff">12<\/tspan>/);
  assert.doesNotMatch(iconSvg,/12%|#e8ff4c/);
  assert.match(serviceWorker,/r12-shell-v5/);
  const ico=readFileSync("public/favicon.ico");assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),1);assert.equal(ico[6],48);
  const pngSize=(path:string)=>{const png=readFileSync(path);assert.equal(png.toString("hex",0,8),"89504e470d0a1a0a",`${path} must be a PNG`);return [png.readUInt32BE(16),png.readUInt32BE(20)];};
  assert.match(root,/r12-app-assets\/favicon-16\.png/);
  for(const [path,size] of [["public/r12-app-assets/favicon-16.png",16],["public/r12-app-assets/favicon-32.png",32],["public/r12-app-assets/favicon-48.png",48],["public/r12-app-assets/apple-touch-icon.png",180],["public/r12-app-assets/icon-192.png",192],["public/r12-app-assets/icon-512.png",512],["public/r12-app-assets/club-icon-192.png",192],["public/r12-app-assets/club-icon-512.png",512]] as const)assert.deepEqual(pngSize(path),[size,size],`${path} dimensions`);
});
