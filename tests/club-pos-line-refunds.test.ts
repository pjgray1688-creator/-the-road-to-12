import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { refundLineAmount, refundSelectionTotal, type RefundableLine } from "../lib/club-refund-allocation";

const migration = readFileSync("supabase/migrations/2026-12-11-club-pos-line-refunds.sql", "utf8");
const action = readFileSync("app/club/shop/actions.ts", "utf8");
const component = readFileSync("components/club-recent-sales.tsx", "utf8");
const till = readFileSync("supabase/migrations/2026-12-10-club-till-close-and-service-refunds.sql", "utf8");

const line = (changes: Partial<RefundableLine> = {}): RefundableLine => ({
  orderItemId: "line", productName: "Item", kind: "retail", quantity: 3, lineTotalMinor: 100, saleValueMinor: 100,
  refundedQuantity: 0, refundedMinor: 0, refundableQuantity: 3, refundableMinor: 100,
  unit: "item", originalUnits: 3, ...changes,
});

test("line preview uses deterministic minor-unit allocation for partial and multiple retail lines", () => {
  const uneven = line();
  assert.equal(refundLineAmount(uneven, 1), 33);
  assert.equal(refundLineAmount({ ...uneven, refundedQuantity: 2, refundedMinor: 66 }, 1), 34);
  const fractionalService = line({ orderItemId: "fractional", kind: "service", quantity: 1, lineTotalMinor: 100, saleValueMinor: 100, unit: "session", originalUnits: 3, refundableQuantity: 3, availableUnits: 3 });
  assert.equal(refundLineAmount(fractionalService, 1), 34);
  assert.equal(refundLineAmount({ ...fractionalService, refundableQuantity: 2, availableUnits: 2 }, 1), 33);
  assert.equal(refundLineAmount({ ...fractionalService, refundableQuantity: 1, availableUnits: 1 }, 1), 33);
  const service = line({ orderItemId: "pt", kind: "service", lineTotalMinor: 20_000, saleValueMinor: 20_000, quantity: 1, unit: "session", originalUnits: 10, refundableQuantity: 4, refundableMinor: 8_000 });
  assert.equal(refundLineAmount(service, 2), 4_000);
  assert.equal(refundSelectionTotal([line({ lineTotalMinor: 300, saleValueMinor: 300, quantity: 1, refundableQuantity: 1 }), service], { line: 1, pt: 2 }), 4_300);
  assert.equal(refundLineAmount(service, 5), 0);
});

test("line refund RPC is quantity-based, locks receipt/lines/lots, and records allocation and financial evidence atomically", () => {
  const rpc = migration.slice(migration.indexOf("create or replace function public.club_issue_staff_line_refund"));
  assert.match(migration, /create table if not exists public\.club_refund_line_allocations/);
  assert.match(rpc, /p_allocations jsonb/);
  assert.match(rpc, /from public\.club_payments where id=p_payment_id for update/);
  assert.match(rpc, /from public\.club_orders where id=p\.order_id[\s\S]*for update/);
  assert.match(rpc, /club_capability_allowed\(p\.organisation_id,auth\.uid\(\),'refunds\.issue'\)/);
  assert.match(rpc, /club_location_authorized\(o\.organisation_id,o\.location_id\)/);
  assert.match(rpc, /for update loop/);
  assert.match(rpc, /units>remaining_units/);
  assert.doesNotMatch(rpc, /p_amount_minor/);
  assert.match(rpc, /refund_line_allocations/);
  assert.match(rpc, /club_refund_service_credit_reversals/);
  assert.match(migration, /club_refund_line_net_value/);
  assert.match(migration, /'available_units',case when i\.stock_tracked then can_refund else remaining_units end/);
  assert.match(migration, /A pre-migration service refund may have been recorded against the[\s\S]*gross amount/);
  assert.match(rpc, /total_minor>p\.amount_minor-prior_paid/);
  assert.match(rpc, /club_balance_entries/);
  assert.match(rpc, /payment\.refund_issued/);
  assert.match(migration, /revoke all on function public\.club_issue_staff_refund\(uuid,integer,text,text,text\) from public,anon,authenticated/);
  assert.match(action, /club_issue_staff_line_refund/);
  assert.match(action, /allocations: input\.allocations\.map/);
  assert.match(component, /Refund value/);
  assert.match(component, /Provider refund reference/);
});

test("line allocation permits mixed receipts, idempotent replay and preserves till cash refund accounting", () => {
  assert.match(migration, /line_kind text not null check\(line_kind in \('retail','service'\)\)/);
  assert.match(migration, /unique\(refund_id,order_item_id\)/);
  assert.match(migration, /existing_allocations|recorded<>requested/);
  assert.match(migration, /idempotency_key/);
  assert.match(migration, /raise exception 'Selected receipt line is unavailable'/);
  assert.match(till, /select -r\.amount_minor::bigint/);
  assert.match(migration, /from public\.club_refunds x where x\.order_id=o\.id/);
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2026-12-10-club-till-close-and-service-refunds.sql") < manifest.indexOf("2026-12-11-club-pos-line-refunds.sql"));
});
