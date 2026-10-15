import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACTIVE_SPORTS_HEADERS, buildClubShopProductUniverse, prepareActiveSportsImport } from "@/lib/club-supplier-catalogue";

const migration=readFileSync("supabase/migrations/2026-12-23-club-attendance-station-leaderboard.sql","utf8");
const manifest=readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt","utf8");

function activeSportsCsv(...rows:Array<Record<string,string>>) {
  const headers=[...ACTIVE_SPORTS_HEADERS,"Trade Cost ex VAT","VAT Rate","Cost Source / Snapshot"];
  const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
  return [headers.map(quote).join(","),...rows.map(row=>headers.map(header=>quote(row[header]??"")).join(","))].join("\n");
}
function rtd(size:string,flavour:string) { return {Supplier:"Active Sports Nutrition",Brand:"Applied Nutrition","Parent Product":"High Protein Shake RTD",Category:"Food & Drinks",Subcategory:"Ready to Drink Protein","Size / Format":size,"Variant / Flavour":flavour,"Pack Qty":"8","Member Order Unit":"Case","Supplier Stock":"In stock","Stock Checked":"2026-09-08","Supplier SKU":`SKU-${size}-${flavour}`,"Source URL":"https://supplier.example/rtd","Trade Cost ex VAT":size.includes("330")?"10.80":"13.92","VAT Rate":"0%","Cost Source / Snapshot":"Reviewed source"}; }

test("Applied generic High Protein Shake RTD normalizes to the correct 20G and 42G families",()=>{
  const prepared=prepareActiveSportsImport(activeSportsCsv(rtd("8 x 330ml","Fudge Brownie"),rtd("8 x 500ml","Banana")));
  assert.deepEqual(prepared.rows.map(row=>row.name),["High Protein Shake RTD 20G","High Protein Shake RTD 42G"]);
  assert.equal(prepared.rows.some(row=>row.name==="High Protein Shake RTD"),false);
  assert.deepEqual(prepared.rows.map(row=>row.parentKey),["applied nutrition|high protein shake rtd 20g","applied nutrition|high protein shake rtd 42g"]);
});

test("unrecognised generic Applied RTD size is rejected instead of recreating a generic family",()=>{
  const prepared=prepareActiveSportsImport(activeSportsCsv(rtd("12 x 250ml","Chocolate")));
  assert.equal(prepared.rows.length,0);
  assert.match(prepared.errors.map(error=>error.reason).join(" "),/requires a recognised 330ml or 500ml format/);
});

test("shop universe suppresses only the exact stale supplier-linked generic RTD",()=>{
  const base={organisationId:"org",active:true,stockTracked:false,currency:"GBP",createdAt:"",updatedAt:"",sellPriceMinor:2000};
  const products=buildClubShopProductUniverse([
    {...base,id:"stale",brand:"Applied Nutrition",name:"High Protein Shake RTD",supplierReference:"supplier_product:old"},
    {...base,id:"20g",brand:"Applied Nutrition",name:"High Protein Shake RTD 20G",supplierReference:"supplier_product:20"},
    {...base,id:"42g",brand:"Applied Nutrition",name:"High Protein Shake RTD 42G",supplierReference:"supplier_product:42"},
    {...base,id:"local",brand:"Other Brand",name:"High Protein Shake RTD"},
  ] as never,[],"org");
  assert.deepEqual(products.map(product=>product.id),["local","20g","42g"]);
});

test("attendance event stream is tied to allowed audited access decisions and dedupes one visit per two hours",()=>{
  assert.match(migration,/create table if not exists public\.club_attendance_visits/);
  assert.match(migration,/method text not null,[\s\S]+source text not null check\(source in \('reception','device'\)\)/);
  assert.match(migration,/device_id uuid references public\.club_access_devices/);
  assert.match(migration,/d\.decision='allow' and d\.attendance_recorded/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/club_attendance_repeat_window\(\)/);
  assert.match(migration,/select interval '2 hours'/);
  assert.match(migration,/new\.attendance_recorded:=false/);
  assert.match(migration,/on conflict\(access_decision_id\) do nothing/);
  assert.match(migration,/public\.club_reception_access_decision\(p_organisation_id,p_location_id,p_credential,'qr'\)/);
});

test("station scan requires staff capability, same-organisation active venue and opaque member QR",()=>{
  assert.match(migration,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.view'\)/);
  assert.match(migration,/where id=p_location_id and organisation_id=p_organisation_id and active/);
  assert.match(migration,/club_checkin_station_scan/);
  const scanRpc=migration.slice(migration.indexOf("create or replace function public.club_checkin_station_scan"),migration.indexOf("create or replace function public.club_monthly_attendance_leaderboard"));
  assert.doesNotMatch(scanRpc,/customerId|membershipId|email|phone/i);
  const component=readFileSync("components/club-checkin-station.tsx","utf8");
  assert.match(component,/R12-\[A-F0-9\]\{32\}/);
  assert.match(component,/onKeyDown/);
  assert.match(component,/focusScan/);
  assert.match(component,/You’re checked in/);
  assert.doesNotMatch(component,/customerId|email|phone|dateOfBirth/i);
});

test("monthly leaderboard is current UK calendar month, actual-location filtered and member-scoped",()=>{
  assert.match(migration,/club_monthly_attendance_leaderboard/);
  assert.match(migration,/club_members m where m\.organisation_id=p_organisation_id and m\.user_id=auth\.uid\(\) and m\.active/);
  assert.match(migration,/v\.organisation_id=p_organisation_id/);
  assert.match(migration,/p_location_id is null or v\.location_id=p_location_id/);
  assert.match(migration,/Europe\/London/);
  assert.match(migration,/dense_rank\(\) over\(order by visits desc\)/);
  assert.doesNotMatch(migration,/email|phone|date_of_birth/i);
  assert.ok(manifest.indexOf("2026-12-22-member-import-home-location.sql")<manifest.indexOf("2026-12-23-club-attendance-station-leaderboard.sql"));
});

test("member shop starts from valid home location without repeatedly overriding selection",()=>{
  const page=readFileSync("app/member-hub/shop/page.tsx","utf8");
  const shop=readFileSync("components/club-shop.tsx","utf8");
  assert.match(page,/profile\.homeLocation\?\.active \? profile\.homeLocation\.id/);
  assert.match(page,/currentLocationId=\{selectedLocationId\}/);
  assert.match(shop,/useState\(currentLocationId \?\? locations\.find/);
  assert.match(shop,/onLocationChange=\{setLocationId\}/);
  assert.doesNotMatch(migration,/preferred_location_id[^;]*(access|entitlement)/i);
});
