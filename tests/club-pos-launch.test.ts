import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isProductOnChannel, type ClubCommerceProduct } from "../lib/club-commerce";
import { mapCommerceProduct } from "../lib/supabase-club-repository";

const sql=readFileSync("supabase/migrations/2026-12-07-club-pos-sellable-units-and-pt-packages.sql","utf8");
const action=readFileSync("app/club/shop/actions.ts","utf8");
const checkout=readFileSync("components/club-staff-checkout.tsx","utf8");
const memberPage=readFileSync("app/member-hub/orders/page.tsx","utf8");
const coachClientRoute=readFileSync("app/api/coach/clients/[id]/route.ts","utf8");
const coachClientWorkspace=readFileSync("components/coach-client-workspace.tsx","utf8");

const product=(salesChannels:ClubCommerceProduct["salesChannels"]):ClubCommerceProduct=>({id:"item",organisationId:"org",name:"Can",active:true,stockTracked:true,sellPriceMinor:150,currency:"GBP",salesChannels,unitLabel:"can",createdAt:"",updatedAt:""});

test("commerce product maps unit, channel and service-package fields",()=>{
  const value=mapCommerceProduct({id:"p",organisation_id:"o",name:"5 PT sessions",active:true,stock_tracked:false,sell_price_minor:5000,currency:"GBP",sales_channels:["pos"],unit_label:"package",source_product_id:"case",units_per_source:12,service_id:"service",service_credit_quantity:5,service_validity_days:90,created_at:"",updated_at:""});
  assert.deepEqual(value.salesChannels,["pos"]);assert.equal(value.unitLabel,"package");assert.equal(value.unitsPerSource,12);assert.equal(value.isServiceProduct,true);assert.equal(value.serviceCreditQuantity,5);assert.equal(value.serviceValidityDays,90);
});

test("channel flags restrict POS and online visibility, while legacy products remain compatible",()=>{
  assert.equal(isProductOnChannel(product(["pos"]),"pos"),true);assert.equal(isProductOnChannel(product(["pos"]),"online"),false);assert.equal(isProductOnChannel(product(["online"]),"pos"),false);assert.equal(isProductOnChannel(product(undefined),"online"),true);
  assert.match(checkout,/isProductOnChannel\(product,"pos"\)/);assert.match(readFileSync("app/member-hub/shop/page.tsx","utf8"),/isProductOnChannel\(product,"online"\)/);
});

test("staff cash checkout reserves location stock before settling and cancels an unpayable order",()=>{
  const cash=action.slice(action.indexOf("export async function staffCashSaleAction"),action.indexOf("export async function cancelStaffPendingOrderAction"));
  assert.ok(cash.indexOf("createCommerceOrder")<cash.indexOf("reserveAndSettleStaffOrder"));assert.ok(cash.indexOf("reserveAndSettleStaffOrder")<cash.indexOf("recordCashPayment"));assert.match(cash,/cleanupStaffSale/);const reservation=readFileSync("supabase/migrations/2026-09-14-club-stock-reservations.sql","utf8");assert.match(reservation,/pg_advisory_xact_lock/);assert.match(reservation,/Insufficient stock for reservation/);
  assert.match(action,/club_reserve_order_stock/);assert.match(action,/staffSpendBalance/);assert.match(action,/staffSettleSplitPayment/);
});

test("single-unit stock is separate from source stock and stock remains location-ledger based",()=>{
  assert.match(sql,/source_product_id uuid/);assert.match(sql,/units_per_source integer/);assert.match(sql,/source_product_id, organisation_id\) references public\.club_commerce_products/);assert.match(sql,/sales_channels text\[\]/);
  const reservation=readFileSync("supabase/migrations/2026-09-14-club-stock-reservations.sql","utf8");assert.match(reservation,/organisation_id,location_id,product_id/);assert.match(sql,/sales_channels <@ array\['pos','online'\]/);assert.match(sql,/Adjustment would use stock reserved for checkout/);assert.match(sql,/if on_hand-reserved<p_quantity then raise exception 'Insufficient free stock'/);assert.match(sql,/club_stock_reservations[\s\S]*status='active'/);
});

test("paid PT package lines grant idempotent, expiry-aware credits without consuming them",()=>{
  assert.match(sql,/club_grant_purchased_service_package/);assert.match(sql,/new\.payment_status not in \('paid','waived'\)/);assert.match(sql,/pt-package:/);assert.match(sql,/expires_at/);assert.match(sql,/on conflict \(organisation_id,idempotency_key\) do nothing/);
  assert.match(sql,/service_credit_quantity integer/);assert.match(sql,/club_service_credit_lots/);assert.match(sql,/club_list_my_pt_package_balances/);assert.match(memberPage,/club_list_my_pt_package_balances/);assert.match(memberPage,/pt_sessions:/);
  assert.doesNotMatch(sql,/club_schedule_events[\s\S]{0,500}club_service_credit_lots/);
});

test("sales-channel, product and credit writes are organisation scoped and management gated",()=>{
  assert.match(sql,/public\.club_has_active_role\(p_organisation_id,array\['gym_admin','owner'\]\)/);assert.match(sql,/source_product_id, organisation_id\) references public\.club_commerce_products\(id, organisation_id\)/);assert.match(sql,/revoke all on function public\.club_save_pos_product/);assert.match(sql,/grant execute on function public\.club_save_pos_product[\s\S]*to authenticated/);
  const manifest=readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt","utf8");assert.ok(manifest.indexOf("2026-12-06-madhouse-rota-and-availability.sql")<manifest.indexOf("2026-12-07-club-pos-sellable-units-and-pt-packages.sql"));
});

test("Coach receives only assigned Madhouse client's remaining PT credits",()=>{
  assert.match(sql,/club_list_coach_client_pt_package_balances/);assert.match(sql,/a\.coach_user_id=auth\.uid\(\) and a\.client_user_id=p_client_user_id and a\.active/);assert.match(sql,/coach_permissions cp/);assert.match(sql,/m\.role='trainer'/);assert.match(sql,/c\.user_id=p_client_user_id/);
  assert.match(coachClientRoute,/club_list_coach_client_pt_package_balances/);assert.match(coachClientRoute,/remaining: Number\(row\.remaining_quantity/);assert.match(coachClientWorkspace,/PT PACKAGE/);assert.match(coachClientWorkspace,/sessions.*remaining/);
  assert.doesNotMatch(coachClientRoute,/unit_price_minor|payment_method|external_reference/);
});
