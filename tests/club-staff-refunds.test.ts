import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-09-club-staff-refunds.sql", "utf8");
const action = readFileSync("app/club/shop/actions.ts", "utf8");
const page = readFileSync("app/club/shop/page.tsx", "utf8");
const view = readFileSync("components/club-recent-sales.tsx", "utf8");

test("staff refund RPC is authenticated, capability-gated and serializes refunds per payment", () => {
  assert.match(migration, /security definer set search_path=pg_catalog,public/);
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /club_capability_allowed\(p\.organisation_id,auth\.uid\(\),'refunds\.issue'\)/);
  assert.match(migration, /club_location_authorized\(o\.organisation_id,o\.location_id\)/);
  assert.match(migration, /from public\.club_payments where id=p_payment_id for update/);
  assert.match(migration, /p_amount_minor>p\.amount_minor-already_refunded/);
});

test("refunds are idempotent, auditable, and return Balance value to its original account", () => {
  assert.match(migration, /club_refunds_org_idempotency_uq/);
  assert.match(migration, /existing_refund\.payment_id<>p\.id/);
  assert.match(migration, /entry_type,amount_delta_minor,balance_after_minor,order_id,payment_id,actor_user_id,reason,idempotency_key/);
  assert.match(migration, /'refund:'\|\|r\.id::text/);
  assert.match(migration, /payment\.refund_issued/);
  assert.match(migration, /created_by,idempotency_key/);
});

test("refund recording never fakes external provider refunds or silently alters returned stock", () => {
  assert.match(migration, /p\.method not in \('cash','balance'\) and nullif\(btrim\(p_external_reference\),''\) is null/);
  assert.match(migration, /Complete the provider refund first/);
  assert.match(migration, /not i\.stock_tracked/);
  assert.match(view, /Refund externally first/);
  assert.match(view, /checked in separately/);
});

test("authorized reception staff can find recent sales and record tender-specific line refunds", () => {
  assert.match(action, /hasCapability\(value\.organisation\.id, value\.userId, "refunds\.issue"\)/);
  assert.match(action, /club_issue_staff_line_refund/);
  assert.match(page, /loaded\.canIssueRefund \? <ClubRecentSales/);
  assert.match(page, /\.eq\("channel", "staff_checkout"\)/);
  assert.match(view, /Refund to Balance/);
  assert.match(view, /Record cash refund/);
  assert.match(view, /Provider refund reference/);
  assert.match(view, /Choose the exact items or service units/);
  assert.match(view, /Selected refund total/);
});

test("refund migration follows live launch migrations in deployment manifest", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2026-12-08-notification-claim-recovery.sql") < manifest.indexOf("2026-12-09-club-staff-refunds.sql"));
});
