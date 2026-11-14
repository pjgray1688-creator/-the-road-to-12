import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("live application uses the Carlton-authorised secure Glow scanner RPC", () => {
  const actions = read("app/club/sunbeds/actions.ts");
  const expand = read("supabase/migrations/2027-01-28-club-staff-data-access-expand.sql");
  assert.match(actions, /rpc\("club_glow_scan_session_request_secure"/);
  assert.match(expand, /revoke all on function public\.club_glow_scan_session_request_secure\(uuid,text\) from public,anon,authenticated/);
  assert.match(expand, /grant execute on function public\.club_glow_scan_session_request_secure\(uuid,text\) to authenticated/);
  const secureStart = expand.indexOf("create or replace function public.club_glow_scan_session_request_secure");
  const secureEnd = expand.indexOf("create or replace function", secureStart + 1);
  const secureScanner = expand.slice(secureStart, secureEnd);
  assert.match(secureScanner, /club_glow_carlton_staff_allowed\(p_organisation_id\)/);
  assert.match(secureScanner, /where organisation_id=p_organisation_id and token_hash=/);
});

test("repository CONTRACT re-grant of the legacy DOB-bearing Glow scanner is corrected by a separate revocation migration", () => {
  const contract = read("supabase/migrations/2027-01-29-club-staff-data-access-contract.sql");
  const correction = read("supabase/migrations/2027-01-30-club-glow-retire-legacy-scan-grant.sql");
  assert.match(contract, /revoke all on function public\.club_glow_scan_session_request\(uuid,text\) from public,anon,authenticated/);
  assert.match(contract, /grant execute on function public\.club_glow_scan_session_request\(uuid,text\) to authenticated/);
  assert.match(correction, /to_regprocedure\('public\.club_glow_scan_session_request_secure\(uuid,text\)'\) is null/);
  assert.match(correction, /revoke all on function public\.club_glow_scan_session_request\(uuid,text\) from public, anon, authenticated/);
  assert.doesNotMatch(correction, /grant execute/i);
  assert.doesNotMatch(correction, /club_glow_scan_session_request_secure\(uuid,text\) from/);
});

test("finance and external-payment RPCs retain server-side capability checks and scoped reporting", () => {
  const finance = read("supabase/migrations/2026-11-13-club-finance-revenue-breakdowns.sql");
  const glowFinance = read("supabase/migrations/2026-11-13-club-glow-finance-report-rpc.sql");
  const glowManagement = read("supabase/migrations/2026-11-13-club-glow-management-report-rpc.sql");
  const orders = read("supabase/migrations/2026-11-13-club-management-orders-external-payments.sql");
  assert.match(finance, /club_list_finance_commerce_category_report_secure[\s\S]*?club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.view'\)/);
  assert.match(glowFinance, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.view'\)/);
  assert.match(glowManagement, /club_location_authorized\(p_organisation_id,p_location_id\)/);
  assert.match(orders, /club_management_verify_order_payment_secure[\s\S]*?club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.manage'\)/);
  for (const source of [finance, glowFinance, glowManagement, orders]) {
    assert.match(source, /revoke all on function[\s\S]*?from public,anon,authenticated/);
    assert.match(source, /grant execute on function[\s\S]*?to authenticated/);
  }
});

test("shared-station secret operations remain service-role-only and QR check-in authenticates station identity", () => {
  const pin = read("supabase/migrations/2026-12-28-club-shared-station-pin-auth.sql");
  const reauth = read("supabase/migrations/2026-12-30-club-station-password-reauth.sql");
  const checkin = read("supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql");
  assert.match(pin, /club_station_verify_pin\(uuid,text,uuid,text\) to service_role/);
  assert.doesNotMatch(pin, /grant[^;]+club_station_verify_pin[^;]+authenticated/i);
  assert.match(reauth, /club_station_set_pin_after_password\(uuid,uuid,text\)[\s\S]*?to service_role/);
  assert.match(checkin, /club_checkin_station_scan\(p_station_id uuid,p_station_token text,p_credential text\)[\s\S]*?club_capability_allowed\(s\.organisation_id,auth\.uid\(\),'members\.view'\)/);
});
