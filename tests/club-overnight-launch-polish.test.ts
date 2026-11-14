import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateManagementOrderLines } from "../lib/club-management-order-lines";

const uuid="2a22b008-2698-4fb8-8644-4f9139f53614";

test("management order validator accepts catalogue and manually priced mixed lines",()=>{
  const result=validateManagementOrderLines([
    {kind:"catalogue",productId:uuid,quantity:2},
    {kind:"manual_service",description:"Bespoke PT block",quantity:1,unitPriceMinor:25000,notes:"Agreed with customer"},
    {kind:"manual_physical",description:"Custom clothing bundle",quantity:1,unitPriceMinor:4000,stockProductId:uuid},
  ]);
  assert.equal(result.ok,true);
  if(result.ok)assert.equal(result.needsManualPricing,true);
});

test("manual order line validation rejects negative, fractional, excessive and unsafe stock inputs",()=>{
  for(const item of [
    {kind:"manual_service",description:"PT",quantity:1,unitPriceMinor:-1},
    {kind:"manual_service",description:"PT",quantity:1,unitPriceMinor:10.5},
    {kind:"manual_service",description:"PT",quantity:50,unitPriceMinor:2147483647},
    {kind:"manual_service",description:"PT",quantity:1,unitPriceMinor:100,stockProductId:uuid},
  ]) assert.equal(validateManagementOrderLines([item]).ok,false);
  assert.equal(validateManagementOrderLines([{kind:"catalogue",productId:"bad",quantity:1}]).ok,false);
  assert.equal(validateManagementOrderLines([]).ok,false);
});

test("manual order SQL uses shared order lines, pricing capability, idempotency and existing stock reservation semantics",()=>{
  const sql=readFileSync("supabase/migrations/2026-11-14-club-management-manual-order-lines.sql","utf8");
  assert.match(sql,/club_order_items alter column product_id drop not null/i);
  assert.match(sql,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.manage'\)/);
  assert.match(sql,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'commerce\.pricing_manage'\)/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/club_management_create_order_secure\(/);
  assert.match(sql,/club_order_items\(order_id,organisation_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,stock_tracked,line_kind,manual_notes\)/);
  assert.match(sql,/grant execute on function public\.club_management_create_order_with_manual_lines_secure[\s\S]*to authenticated/i);
});

test("Management orders are discoverable in Shop Administration and not duplicated in Shop header",()=>{
  const more=readFileSync("app/club/more/page.tsx","utf8");
  const shop=readFileSync("app/club/shop/page.tsx","utf8");
  const overview=readFileSync("app/club/page.tsx","utf8");
  assert.match(more,/sectionLabels\.shop[\s\S]*Customer orders & payments/);
  assert.match(more,/canManageOrders[\s\S]*Customer orders & payments/);
  assert.doesNotMatch(shop,/Create customer order/i);
  assert.match(overview,/canManageOrders[\s\S]*Customer orders/);
});

test("Management action rows are distinct keyboard-accessible targets at every viewport",()=>{
  const more=readFileSync("app/club/more/page.tsx","utf8");
  const css=readFileSync("components/club-desktop-shell.module.css","utf8");
  assert.match(more,/className="club-management-links"[\s\S]*<Link[\s\S]*aria-label=\{item\.label\}/);
  assert.doesNotMatch(more,/aria-hidden="true">›/);
  assert.match(css,/:global\(\.club-page \.club-management-links a\)[^{]*\{[^}]*min-height:48px/);
  assert.match(css,/:global\(\.club-page \.club-management-links a:focus-visible\)/);
});

test("daily equipment configuration stays manager-gated and uses the chosen venue-scoped asset RPC",()=>{
  const page=readFileSync("app/club/checks/page.tsx","utf8");
  const checks=readFileSync("components/club-checks.tsx","utf8");
  const actions=readFileSync("app/club/checks/actions.ts","utf8");
  assert.match(page,/hasCapability\(context\.organisation\.id, user\.id, "staff\.work_review"\)/);
  assert.match(checks,/{canReview \? <ManagerConfiguration/);
  assert.match(checks,/location=\$\{encodeURIComponent\(location\.id\)\}#equipment-register/);
  assert.match(checks,/Add Equipment Asset — \{currentLocation\?\.name/);
  assert.match(actions,/club_equipment_save_asset.*p_location_id: text\(formData, "locationId"\)/);
});

test("Club primary, secondary and destructive controls have explicit non-hover contrast states",()=>{
  const css=readFileSync("app/globals.css","utf8");
  assert.match(css,/club-page:not\(\.glow-zone-page\) button\.primary[\s\S]*background:#75429b[\s\S]*color:#fff/);
  assert.match(css,/club-page:not\(\.glow-zone-page\) button\.secondary[\s\S]*background:#fff[\s\S]*color:#39294a/);
  assert.match(css,/club-page:not\(\.glow-zone-page\) button\.danger[\s\S]*color:#8c2632/);
  assert.match(css,/button\.secondary:disabled[\s\S]*color:#625a68/);
  assert.match(css,/focus-visible[\s\S]*outline:3px solid #b68bd0/);
});
