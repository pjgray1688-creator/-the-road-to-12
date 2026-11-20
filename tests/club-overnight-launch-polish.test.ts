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

test("manual-only and catalogue-only order lines remain valid independent order shapes",()=>{
  assert.equal(validateManagementOrderLines([{kind:"catalogue",productId:uuid,quantity:1}]).ok,true);
  assert.equal(validateManagementOrderLines([{kind:"manual_service",description:"One-off PT session",quantity:1,unitPriceMinor:5000}]).ok,true);
  assert.equal(validateManagementOrderLines([{kind:"manual_physical",description:"Uncatalogued item",quantity:1,unitPriceMinor:2500}]).ok,true);
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
  assert.match(sql,/idempotency_key=p_idempotency_key for update/);
  assert.match(sql,/if found then[\s\S]*'replayed',true/);
  assert.match(sql,/club_management_create_order_secure\(/);
  assert.match(sql,/club_order_items\(order_id,organisation_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,stock_tracked,line_kind,manual_notes\)/);
  assert.match(sql,/grant execute on function public\.club_management_create_order_with_manual_lines_secure[\s\S]*to authenticated/i);
  const confirmation=readFileSync("supabase/migrations/2026-11-13-club-management-orders-external-payments.sql","utf8");
  assert.match(confirmation,/club_management_confirm_order_secure[\s\S]*club_reserve_order_stock/);
});

test("order-item trigger permits only authorised draft staff manual lines and preserves catalogue channels",()=>{
  const sql=readFileSync("supabase/migrations/2026-11-14-club-management-manual-order-lines.sql","utf8");
  const guard=sql.slice(sql.indexOf("create or replace function public.club_validate_commerce_order_item_channel"),sql.indexOf("drop trigger if exists club_order_item_sales_channel"));
  assert.match(guard,/new\.product_id is null/);
  assert.match(guard,/new\.line_kind not in \('manual_service','manual_physical'\)/);
  assert.match(guard,/order_channel is distinct from 'staff_checkout'/);
  assert.match(guard,/order_status is distinct from 'draft'/);
  assert.match(guard,/order_creator is distinct from auth\.uid\(\)/);
  assert.match(guard,/finance\.manage/);
  assert.match(guard,/commerce\.pricing_manage/);
  assert.match(guard,/club_location_authorized\(new\.organisation_id,order_location\)/);
  assert.match(guard,/where o\.id=new\.order_id and o\.organisation_id=new\.organisation_id/);
  assert.match(guard,/where p\.id=new\.product_id and p\.organisation_id=new\.organisation_id/);
  assert.match(guard,/not \('pos'=any\(channels\)\)/);
  assert.match(guard,/not \('online'=any\(channels\)\)/);
  assert.match(guard,/club_commerce_package_rules/);
  assert.match(sql,/before insert or update of product_id,order_id,organisation_id,line_kind,stock_tracked,product_name,quantity,unit_price_minor,line_total_minor/);
  assert.match(sql,/club_prevent_manual_order_channel_change/);
  assert.match(sql,/new\.channel is distinct from 'staff_checkout'/);
});

test("manual physical stock links pass supplier and service guards, then reserve through the audited order confirmation flow",()=>{
  const sql=readFileSync("supabase/migrations/2026-11-14-club-management-manual-order-lines.sql","utf8");
  const reservation=readFileSync("supabase/migrations/2026-09-14-club-stock-reservations.sql","utf8");
  const confirmation=readFileSync("supabase/migrations/2026-11-13-club-management-orders-external-payments.sql","utf8");
  assert.match(sql,/club_guard_supplier_order_item\(\)/);
  assert.match(sql,/club_guard_service_package_purchase\(\)/);
  assert.match(sql,/club_snapshot_commerce_reporting_category\(\)/);
  assert.match(sql,/club_stock_reservation_sale_trigger\(\)/);
  assert.match(sql,/club_stock_reservation_order_trigger\(\)/);
  assert.match(sql,/club_reserve_order_stock\(uuid\)/);
  assert.match(sql,/product_service_id is not null/);
  assert.match(sql,/product_stock_tracked/);
  assert.match(reservation,/for v_item in select \* from public\.club_order_items where order_id=v_order\.id and stock_tracked loop/);
  assert.match(reservation,/order_item_id,quantity\)[\s\S]*v_item\.id,v_item\.quantity/);
  assert.match(confirmation,/v_reserved:=public\.club_reserve_order_stock\(v_order\.id\)/);
});

test("Management orders are discoverable in Shop Administration and not duplicated in Shop header",()=>{
  const more=readFileSync("app/club/more/page.tsx","utf8");
  const shop=readFileSync("app/club/shop/page.tsx","utf8");
  const overview=readFileSync("app/club/page.tsx","utf8");
  assert.match(more,/sectionLabels\.shop[\s\S]*Customer orders & payments/);
  assert.match(more,/canManageOrders[\s\S]*Customer orders & payments/);
  assert.doesNotMatch(shop,/Create customer order/i);
  assert.doesNotMatch(overview,/Customer orders/);
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
