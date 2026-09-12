import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTIVE_SPORTS_HEADERS, prepareActiveSportsImport, supplierPricing, parseActiveSportsCommercialFields, durableSupplierRowsToProducts, activeSportsCoverage, supplierVariantOrderable, activeSportsIdentity, type DurableSupplierParentRow } from "../lib/club-supplier-catalogue";
import { supplierOrderable } from "../lib/club-member-availability";

const headers = [...ACTIVE_SPORTS_HEADERS, "Trade Cost ex VAT", "VAT Rate", "Cost Source / Snapshot"];
const record: Record<string, string> = { Supplier: "Active Sports", Brand: "Per4m Nutrition", "Parent Product": "Whey", Category: "Supplements", "Size / Format": "2kg", "Variant / Flavour": "Chocolate", "Pack Qty": "1", "Member Order Unit": "Tub", "Supplier Stock": "In stock", "Stock Checked": "2026-09-10", "Trade Cost ex VAT": "20.00", "VAT Rate": "20%", "Cost Source / Snapshot": "Reviewed final supplier snapshot" };
function csv(...rows: Array<Record<string, string>>) { const escape = (value: string) => `"${value.replaceAll('"','""')}"`; return [headers.map(escape).join(","), ...rows.map(row => headers.map(key => escape(row[key] ?? "")).join(","))].join("\n"); }

test("20% and VAT FREE costs feed 30% gross margin and upward whole-pound floor", () => {
  assert.deepEqual(supplierPricing(2000, 0), { trueCostMinor: 2000, recommendedFloorMinor: 2900, livePriceMinor: 2900, marginPercent: 900 / 2900 * 100, belowFloor: false });
  assert.equal(supplierPricing(2000, .2).trueCostMinor, 2400);
  assert.equal(supplierPricing(2000, .2).recommendedFloorMinor, 3500);
  assert.equal(supplierPricing(2030, 0).recommendedFloorMinor, 2900); // exactly £29, not £30
  assert.equal(supplierPricing(0, 0).recommendedFloorMinor, 0);
  for (const rate of ["0", "0%", "VAT FREE"]) assert.equal(prepareActiveSportsImport(csv({ ...record, "VAT Rate": rate })).rows[0].purchaseVatRate, 0);
  assert.equal(prepareActiveSportsImport(csv({ ...record, "VAT Rate": "0.2" })).rows[0].purchaseVatRate, .2);
  assert.equal(prepareActiveSportsImport(csv({ ...record, "VAT Rate": "" })).rows[0].purchaseVatRate, .2);
});

test("manual live price survives new cost, recalculating the floor and flag instead of overwriting", () => {
  const approved = supplierPricing(1000, .2, 2000);
  const refreshed = supplierPricing(2000, .2, approved.livePriceMinor);
  assert.equal(refreshed.livePriceMinor, 2000);
  assert.equal(refreshed.recommendedFloorMinor, 3500);
  assert.equal(refreshed.belowFloor, true);
});

test("whole unavailable parent excluded, genuine unavailable sibling retained", () => {
  const parsed = prepareActiveSportsImport(csv(record, { ...record, "Variant / Flavour": "Vanilla", "Supplier Stock": "Out of stock" }, { ...record, "Parent Product": "Other whey", "Supplier Stock": "Out of stock" }));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.summary.retainedParentProducts, 1);
  assert.equal(parsed.summary.exactVariants, 2);
  assert.equal(parsed.summary.unavailableSiblingsRetained, 1);
  assert.equal(parsed.summary.excludedParents, 1);
});

test("variant identity includes flavour and size while barcode/SKU remain linking metadata", () => {
  const a = { supplier: "Active Sports", name: "Whey", flavour: "Chocolate", size: "2kg", supplierSku: "000123", stockStatus: "available" as const };
  assert.equal(activeSportsIdentity(a), activeSportsIdentity({ ...a, name: "Updated whey" }));
  const parsed = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "000123" }, { ...record, "Supplier SKU": "000123", "Variant / Flavour": "Vanilla" }));
  assert.deepEqual(parsed.duplicateRows, []);
  assert.equal(parsed.duplicateGroups.length, 0);
  const sameVariant = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "000123" }, { ...record, "Supplier SKU": "000123", "Barcode": "00999999" }));
  assert.deepEqual(sameVariant.duplicateRows, [2, 3]);
  const differentSize = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "000123" }, { ...record, "Supplier SKU": "000123", "Size / Format": "1kg" }));
  assert.deepEqual(differentSize.duplicateRows, []);
  const barcodeFlavours = prepareActiveSportsImport(csv({ ...record, Barcode: "12345678", "Supplier SKU": "A" }, { ...record, Barcode: "12345678", "Supplier SKU": "B", "Variant / Flavour": "Vanilla" }));
  assert.deepEqual(barcodeFlavours.duplicateRows, []);
  const differentBrand = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "BRAND-1", Brand: "10X Athletic" }, { ...record, "Supplier SKU": "BRAND-1", Brand: "Mountain Joe's" }));
  assert.deepEqual(differentBrand.duplicateRows, []);
  const sameBrand = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "BRAND-2", Brand: "10X Athletic" }, { ...record, "Supplier SKU": "BRAND-2", Brand: "10X Athletic", "Trade Cost ex VAT": "21.00" }));
  assert.deepEqual(sameBrand.duplicateRows, [2, 3]);
});

test("identical duplicates are grouped, first row is kept, and validation remains importable", () => {
  const parsed = prepareActiveSportsImport(csv(record, { ...record }));
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.duplicateRows, []);
  assert.equal(parsed.duplicateGroups.length, 1);
  assert.equal(parsed.duplicateGroups[0].identical, true);
  assert.deepEqual(parsed.duplicateGroups[0].autoIgnoredRows, [3]);
  assert.equal(parsed.summary.autoIgnoredDuplicates, 1);
  assert.equal(parsed.rows.length, 1);
});

test("duplicate identity groups expose row facts and only conflicting commercial data fails", () => {
  const sameBarcodeDifferentSku = prepareActiveSportsImport(csv({ ...record, Barcode: "12345678", "Supplier SKU": "SKU-A" }, { ...record, Barcode: "12345678", "Supplier SKU": "SKU-B" }));
  assert.equal(sameBarcodeDifferentSku.duplicateGroups.length, 0);
  const sameFlavour = prepareActiveSportsImport(csv({ ...record, Barcode: "12345678", "Supplier SKU": "SKU-A" }, { ...record, Barcode: "12345678", "Supplier SKU": "SKU-A", "Trade Cost ex VAT": "21.00" }));
  assert.equal(sameFlavour.duplicateGroups.length, 1);
  assert.equal(sameFlavour.duplicateGroups[0].identical, false);
  assert.deepEqual(sameFlavour.duplicateGroups[0].conflictingRows, [2, 3]);
  assert.match(sameFlavour.duplicateGroups[0].identityKey, /sku/);
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].productName, "Whey");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].brand, "Per4m Nutrition");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].supplier, "Active Sports");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].sku, "SKU-A");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].barcode, "12345678");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].variant, "Chocolate");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].size, "2kg");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].stock, "available");
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].costPriceMinor, 2000);
  assert.equal(sameFlavour.duplicateGroups[0].rows[0].vatRate, .2);
  const sameSkuDifferentCost = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "SKU-C" }, { ...record, "Supplier SKU": "SKU-C", "Trade Cost ex VAT": "21.00" }));
  assert.equal(sameSkuDifferentCost.duplicateGroups[0].identical, false);
  assert.equal(sameSkuDifferentCost.errors.some(error => error.reason.includes("Conflicting duplicate identity")), true);
  const chosen = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "SKU-C" }, { ...record, "Supplier SKU": "SKU-C", "Trade Cost ex VAT": "21.00" }), { duplicateChoices: { [sameSkuDifferentCost.duplicateGroups[0].identityKey]: 3 } });
  assert.equal(chosen.errors.some(error => error.reason.includes("Conflicting duplicate identity")), false);
  assert.deepEqual(chosen.duplicateGroups[0].autoIgnoredRows, [2]);
  assert.equal(chosen.rows[0].currentBoldTradeCostExVatMinor, 2100);
  const duplicateBarcode = prepareActiveSportsImport(csv({ ...record, Barcode: "12345678", "Supplier SKU": "SKU-D" }, { ...record, Barcode: "12345678", "Supplier SKU": "SKU-D" }));
  assert.equal(duplicateBarcode.duplicateGroups[0].identical, true);
  const duplicateSku = prepareActiveSportsImport(csv({ ...record, "Supplier SKU": "SKU-E" }, { ...record, "Supplier SKU": "SKU-E" }));
  assert.equal(duplicateSku.duplicateGroups[0].identical, true);
  const mixed = prepareActiveSportsImport(csv({ ...record, Barcode: "12345678", "Supplier SKU": "SKU-F" }, { ...record, Barcode: "12345678", "Supplier SKU": "SKU-G" }));
  assert.equal(mixed.duplicateGroups.length, 0);
});

test("catalogue validation preserves duplicate reports and exposes diagnostic failures", () => {
  const action = readFileSync("app/club/products/actions.ts", "utf8");
  assert.match(action, /syncActiveSportsCatalogueAction/);
  assert.match(action, /club_import_supplier_catalogue_v2/);
  const panel = readFileSync("components/club-supplier-pricing.tsx", "utf8");
  assert.match(panel, /Products updated/);
  assert.match(panel, /New products created/);
});

test("database duplicate validation returns every group with both source records", () => {
  const sql = readFileSync("supabase/migrations/2026-10-17-active-sports-pricing-reconciliation.sql", "utf8");
  assert.match(sql, /duplicate_diagnostics/);
  assert.match(sql, /seen_records/);
  assert.match(sql, /seen_rows/);
  assert.match(sql, /jsonb_build_object\('identityKey'/);
  assert.match(sql, /jsonb_build_array\(seen_records/);
  assert.match(sql, /jsonb_array_length\(duplicate_diagnostics\)>0/);
  const forward = readFileSync("supabase/migrations/2026-10-18-active-sports-duplicate-diagnostics.sql", "utf8");
  assert.match(forward, /create or replace function public\.club_reconcile_active_sports/);
  assert.match(forward, /duplicate_diagnostics/);
  assert.match(forward, /seen_records/);
  assert.match(forward, /grant execute on function public\.club_reconcile_active_sports/);
});

test("supplier uniqueness follows canonical identity instead of SKU alone", () => {
  const sql = readFileSync("supabase/migrations/2026-10-19-active-sports-identity-uniqueness.sql", "utf8");
  assert.match(sql, /drop index if exists public\.club_supplier_products_sku_uq/);
  assert.match(sql, /club_supplier_products_identity_uq/);
  assert.match(sql, /organisation_id, supplier_id, import_identity/);
  assert.match(sql, /existing duplicate identity groups require reconciliation/);
});

test("large publishes upsert each parent once and use scoped scan indexes", () => {
  const sql = readFileSync("supabase/migrations/2026-10-20-active-sports-publish-performance.sql", "utf8");
  assert.match(sql, /parent_keys_done/);
  assert.match(sql, /if not \(v_parent_key=any\(parent_keys_done\)\)/);
  assert.match(sql, /club_supplier_parents_org_supplier_active_idx/);
  assert.match(sql, /club_supplier_products_org_supplier_active_idx/);
  assert.match(sql, /create or replace function public\.club_reconcile_active_sports/);
});

test("reconciliation profiling exposes stage timings for Supabase diagnosis", () => {
  const sql = readFileSync("supabase/migrations/2026-10-21-active-sports-reconcile-profiling.sql", "utf8");
  assert.match(sql, /raise notice '\[active-sports\] csv load/);
  assert.match(sql, /supplier product upsert/);
  assert.match(sql, /availability and retirement/);
  assert.match(sql, /publication/);
  assert.match(sql, /stageTimingsMs/);
  assert.match(sql, /totalMs/);
});

test("supplier import jobs provide worker, retry and persisted progress entrypoints", () => {
  const sql = readFileSync("supabase/migrations/2026-10-23-supplier-import-worker.sql", "utf8");
  assert.match(sql, /club_run_supplier_import_job/);
  assert.match(sql, /club_retry_supplier_import_job/);
  assert.match(sql, /club_get_supplier_import_job/);
  assert.match(sql, /club_import_job_events/);
  assert.match(sql, /club_reconcile_active_sports\(j\.organisation_id/);
  assert.match(sql, /status='failed'/);
});

test("malformed costs, VAT, stock, missing facts and corrupt CSV fail closed", () => {
  for (const value of ["abc", "£abc", "-1", "10.001", "1e3", "1.2.3", ""]) assert.ok(prepareActiveSportsImport(csv({ ...record, "Trade Cost ex VAT": value })).errors.length, value);
  for (const value of ["twenty", "-20", "120%", "20%%"]) assert.ok(prepareActiveSportsImport(csv({ ...record, "VAT Rate": value })).errors.length, value);
  for (const value of ["unknown", "maybe", ""]) assert.ok(prepareActiveSportsImport(csv({ ...record, "Supplier Stock": value })).errors.length);
  assert.ok(prepareActiveSportsImport(csv({ ...record, Brand: "" })).errors.length);
  assert.ok(prepareActiveSportsImport(csv(record) + ',"unclosed').errors.length);
  assert.ok(parseActiveSportsCommercialFields({ "Trade Cost ex VAT": "10", "VAT Rate": "20%", "VAT Treatment": "VAT free" }).errors.length);
});

test("commercial columns stay aligned after rejected source rows; spreadsheet retail is not required", () => {
  const parsed = prepareActiveSportsImport(csv({ ...record, "Parent Product": "", "Trade Cost ex VAT": "99" }, { ...record, "Trade Cost ex VAT": "12.34" }));
  assert.equal(parsed.rows[0].currentBoldTradeCostExVatMinor, 1234);
  assert.equal(prepareActiveSportsImport(csv(record)).errors.length, 0);
});

test("supplier case is a distinct sales unit; unavailable sibling cannot be selected for ordering", () => {
  const parent: DurableSupplierParentRow = { parentKey: "p", supplierId: "s", supplierName: "Active Sports", memberOrderable: true, name: "Case", variants: [{ id: "v1", clubProductId: "canonical1", supplierId: "s", parentKey: "p", flavour: "Chocolate", size: "12 x 60g", stockStatus: "available", retailPriceMinor: 2900, packQuantity: 12, memberOrderableUnit: "case" }, { id: "v2", clubProductId: "canonical2", supplierId: "s", parentKey: "p", flavour: "Vanilla", stockStatus: "unavailable", retailPriceMinor: 2900 }] };
  const products = durableSupplierRowsToProducts([parent], "org");
  assert.equal(products.length, 2); assert.equal(products[0].stockTracked, false); assert.equal(products[0].variantOptions.orderUnit, "case"); assert.equal(products[0].sellPriceMinor, 2900);
  assert.equal(supplierOrderable(products[1]), false);
  assert.equal(supplierVariantOrderable({ id: "s", name: "Active Sports", memberOrderable: true }, parent.variants[1]), false);
  assert.equal(durableSupplierRowsToProducts([{ ...parent, variants: [parent.variants[1]] }], "org").length, 0);
  for (const product of products) for (const field of ["trade_cost_minor", "vat_rate", "costPriceMinor", "manual_price", "cost_history"]) assert.equal(field in product, false);
  assert.equal(durableSupplierRowsToProducts([{ ...parent, variants: [{ ...parent.variants[0], localStockTracked: true }] }], "org")[0].stockTracked, true);
  const prepared = prepareActiveSportsImport(csv({ ...record, "Pack Qty": "12", "Member Order Unit": "Case" }));
  assert.equal(prepared.rows[0].packQuantity, 12);
  assert.equal(prepared.rows[0].currentBoldTradeCostExVatMinor, 2000);
});

test("database reconciliation protects permissions, audited manual pricing, idempotency and local stock", () => {
  const sql = readFileSync("supabase/migrations/2026-10-17-active-sports-pricing-reconciliation.sql", "utf8");
  assert.match(sql, /p_expected_revision is distinct from revision/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /prior=payload and o.import_identity=identity_key then unchanged/);
  assert.match(sql, /supplierSku.*variant.*size/);
  assert.doesNotMatch(sql, /barcode_seen/);
  assert.match(sql, /if not new.manual_price then new.retail_price_minor:=floor_minor/);
  assert.match(sql, /retail_price_minor=p_retail_price_minor,manual_price=true/);
  assert.match(sql, /insert into public.club_supplier_variant_costs/);
  assert.match(sql, /club_guard_supplier_order_item before insert/);
  assert.match(sql, /offer.availability_status<>'available'/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public.club_(?:inventory|stock_movements)\b/);
  for (const name of ["club_reconcile_active_sports", "club_set_supplier_variant_retail_price", "club_list_supplier_pricing"]) {
    const fn = sql.slice(sql.indexOf(`create or replace function public.${name}`)).split("end; $$;")[0];
    assert.match(fn, /auth.uid\(\) is null/); assert.match(fn, /supplier.catalogue_manage/); assert.match(fn, /commerce.pricing_manage/); assert.match(fn, /set search_path=pg_catalog,public/);
  }
  const memberRead = sql.slice(sql.indexOf("create or replace function public.club_list_member_supplier_catalogue")).split("$$;")[0];
  assert.doesNotMatch(memberRead, /trade_cost|wholesale_cost|supplied_vat|manual_price|cost_history/);
  assert.match(memberRead, /available.availability_status='available'/);
});

test("member selector chooses size first and disables only genuine unavailable flavours", async () => {
  const { memberVariantChoices } = await import("../lib/club-product-families");
  const base = { id: "one", organisationId: "org", name: "Whey", active: true, stockTracked: false, sellPriceMinor: 2900, currency: "GBP", createdAt: "", updatedAt: "" };
  const variants = [{ ...base, variantOptions: { size: "2kg", flavour: "Chocolate", orderUnit: "tub" } }, { ...base, id: "out", variantOptions: { size: "2kg", flavour: "Vanilla", orderUnit: "tub" } }, { ...base, id: "three", variantOptions: { size: "1kg", flavour: "Banana", orderUnit: "tub" } }];
  const canOrder = (product: { id: string }) => product.id !== "out";
  assert.deepEqual(memberVariantChoices(variants, {}, canOrder).controls.map(control => control.key), ["size"]);
  const choices = memberVariantChoices(variants, { size: "2kg" }, canOrder);
  assert.deepEqual(choices.controls.find(control => control.key === "flavour")?.values, [{ value: "Chocolate", disabled: false }, { value: "Vanilla", disabled: true }]);
  assert.equal(memberVariantChoices(variants, { size: "1kg", flavour: "Chocolate" }, canOrder).resolved?.id, "three");
});

test("offline CLI validates the actual CSV contract and returns a failing status for rejected rows", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path"); const { spawnSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "active-sports-test-"));
  try {
    const input = join(directory, "fixture.csv"); const output = join(directory, "report.json");
    writeFileSync(input, csv(record));
    const good = spawnSync(process.execPath, ["--import", "tsx", "scripts/active-sports-dry-run.ts", input, output], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).supplierOrderableVariants, 1);
    writeFileSync(input, csv({ ...record, "Trade Cost ex VAT": "invalid" }));
    const bad = spawnSync(process.execPath, ["--import", "tsx", "scripts/active-sports-dry-run.ts", input, output], { encoding: "utf8" });
    assert.equal(bad.status, 1); assert.ok(JSON.parse(readFileSync(output, "utf8")).rejectedRows > 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("supplier import queue has an automatic scheduled worker boundary", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync("supabase/migrations/2026-10-24-supplier-import-worker-trigger.sql", "utf8");
  const route = readFileSync("app/api/internal/supplier-import-worker/route.ts", "utf8");
  const worker = readFileSync("lib/supplier-import-worker.ts", "utf8");
  assert.match(migration, /club_claim_supplier_import_jobs/);
  assert.match(migration, /for update skip locked/i);
  assert.match(route, /runQueuedSupplierImportWorker/);
  assert.match(worker, /club_run_supplier_import_job/);
});

test("Active Sports uses the direct weekly catalogue synchroniser", async () => {
  const action = readFileSync("app/club/products/actions.ts", "utf8");
  assert.match(action, /club_import_supplier_catalogue_v2/);
  assert.doesNotMatch(action, /club_enqueue_supplier_import_job/);
  assert.doesNotMatch(action, /runQueuedSupplierImportWorker/);
  assert.doesNotMatch(action, /club_reconcile_active_sports/);
});

test("worker failure response preserves the original error value", () => {
  const worker = readFileSync("lib/supplier-import-worker.ts", "utf8");
  assert.match(worker, /failed: 1, error, results: \[\]/);
  assert.doesNotMatch(worker, /failed: 1, error: .*String\(error\)/);
});

test("claim RPC aggregates returned UUIDs into its uuid array", () => {
  const sql = readFileSync("supabase/migrations/2026-10-25-fix-import-job-claim-array.sql", "utf8");
  assert.match(sql, /select coalesce\(array_agg\(id\), '\{\}'::uuid\[\]\) into ids from claimed/i);
  assert.doesNotMatch(sql, /returning j\.id into ids/i);
});

test("worker completion requires an explicit valid terminal payload", () => {
  const worker = readFileSync("lib/supplier-import-worker.ts", "utf8");
  assert.match(worker, /value\.status !== "completed"/);
  assert.match(worker, /typeof value\.jobId !== "string"/);
  assert.match(worker, /!\("summary" in value\)/);
  assert.match(worker, /status: payload\?\.status \?\? null/);
});

test("failed worker payload is promoted without replacing its RPC details", () => {
  const worker = readFileSync("lib/supplier-import-worker.ts", "utf8");
  assert.match(worker, /error: firstFailure \? \(firstFailure\.result \?\? firstFailure\.error\)/);
  assert.match(worker, /validationError: firstFailure\?\.validationError/);
});

test("worker qualifies stage column and PL/pgSQL variable", () => {
  const sql = readFileSync("supabase/migrations/2026-10-28-fix-worker-stage-ambiguity.sql", "utf8");
  assert.match(sql, /update public\.club_import_job_events e/);
  assert.match(sql, /e2\.stage=worker\.stage/);
});

test("reconciliation stages supplier products before row matching", () => {
  const sql = readFileSync("supabase/migrations/2026-10-30-stage-supplier-products.sql", "utf8");
  assert.match(sql, /create temporary table worker_supplier_products/i);
  assert.match(sql, /create index worker_supplier_products_identity_idx/i);
  assert.match(sql, /from worker_supplier_products sp/);
});

test("worker persists reconciliation stage timings returned by the RPC", () => {
  const worker = readFileSync("lib/supplier-import-worker.ts", "utf8");
  assert.match(worker, /stageTimingsMs/);
  assert.match(worker, /reconciliation stage completed/);
  assert.match(worker, /durationMs/);
});

test("reconciliation writes each completed stage immediately", () => {
  const sql = readFileSync("supabase/migrations/2026-10-31-reconcile-stage-logging.sql", "utf8");
  for (const stage of ["snapshot complete", "identity matching complete", "duplicate handling complete", "reconciliation complete", "pricing complete", "publish complete"]) assert.match(sql, new RegExp(stage));
  assert.match(sql, /insert into public\.club_import_job_logs/);
});

test("reconciliation persists statement-level timings immediately", () => {
  const sql = readFileSync("supabase/migrations/2026-11-01-reconcile-statement-timings.sql", "utf8");
  assert.match(sql, /supplier identity match/);
  assert.match(sql, /stage supplier products/);
  assert.match(sql, /prior supplier projection/);
  assert.match(sql, /statement completed/);
});

test("statement timing instrumentation emits one match and projection entry", () => {
  const sql = readFileSync("supabase/migrations/2026-11-02-reduce-statement-timing-volume.sql", "utf8");
  assert.match(sql, /match_logged boolean/);
  assert.match(sql, /prior_logged boolean/);
  assert.match(sql, /not match_logged/);
  assert.match(sql, /not prior_logged/);
});

test("remaining reconciliation statements have one-shot timing checkpoints", () => {
  const sql = readFileSync("supabase/migrations/2026-11-03-reconcile-remaining-statement-timings.sql", "utf8");
  for (const statement of ["parent product upsert", "supplier variant insert or update", "commerce product lookup or creation", "availability and retirement queries", "publication updates"]) assert.match(sql, new RegExp(statement));
  assert.match(sql, /parent_logged boolean/);
  assert.match(sql, /publication_logged boolean/);
});

test("post-reconciliation operations have completion checkpoints", () => {
  const sql = readFileSync("supabase/migrations/2026-11-04-post-reconciliation-timings.sql", "utf8");
  for (const marker of ["post-reconciliation result construction complete", "retire unavailable supplier variants complete", "retire unavailable parent products complete", "supplier publication flag update complete", "supplier import batch insert complete", "reconciliation function return reached"]) assert.match(sql, new RegExp(marker));
});

test("worker failure payload includes stage and SQL error context", () => {
  const sql = readFileSync("supabase/migrations/2026-10-27-import-worker-failure-details.sql", "utf8");
  assert.match(sql, /'status','failed'/);
  assert.match(sql, /'stage',coalesce\(stage/);
  assert.match(sql, /'sqlError',jsonb_build_object\('state',sqlstate/);
  assert.match(sql, /'failingProductCount',0/);
});

test("supplier default retail pricing rounds up to the next whole pound", () => {
  assert.equal(supplierPricing(1021, 0).recommendedFloorMinor, 1500);
  assert.equal(supplierPricing(2399, 0).recommendedFloorMinor, 3500);
  assert.equal(supplierPricing(5039, 0).recommendedFloorMinor, 7200);
  assert.equal(supplierPricing(6240, 0).recommendedFloorMinor, 9000);
});

test("Active Sports linker backfills generated prices without touching manual prices", () => {
  const migration = readFileSync(new URL("../supabase/migrations/2026-11-10-backfill-active-sports-generated-prices.sql", import.meta.url), "utf8");
  assert.match(migration, /sell_price_minor=case when not sp\.manual_price then v_price else sell_price_minor end/);
  assert.match(migration, /ceil\(round\(sp\.trade_cost_ex_vat_minor\*\(1\+coalesce\(sp\.supplied_vat_rate,0\.2\)\)\)\/70\.0\)\*100/);
});

test("shared family selector exposes persisted prices and real size/flavour choices", () => {
  const source = readFileSync(new URL("../components/club-product-family-selector.tsx", import.meta.url), "utf8");
  assert.match(source, /priceFor\(card, availability\)/);
  assert.match(source, /club-family-option/);
  assert.match(source, /key !== "orderUnit"/);
  assert.doesNotMatch(source, /Price not set/);
});

test("supplier case pricing remains a case price and is never divided into singles", () => {
  const parent: DurableSupplierParentRow = { parentKey: "abe", supplierId: "active", supplierName: "Active Sports", memberOrderable: true, name: "ABE Pre Workout", variants: [{ id: "case", supplierId: "active", parentKey: "abe", size: "12 x 55g", flavour: "Blue Raspberry", packQuantity: 12, memberOrderableUnit: "case", stockStatus: "available", retailPriceMinor: 1500 }] };
  const product = durableSupplierRowsToProducts([parent], "org")[0];
  assert.equal(product.sellPriceMinor, 1500);
  assert.equal(product.variantOptions?.orderUnit, "case");
  assert.equal(product.variantOptions?.packQuantity, "12");
});

test("ABE formats remain separate families while same-format flavours stay grouped", async () => {
  const { groupProductFamilies } = await import("../lib/club-product-families");
  const base = { organisationId: "org", familyId: "active:abe", brand: "Applied Nutrition", active: true, stockTracked: false, currency: "GBP", sellPriceMinor: 1000, createdAt: "", updatedAt: "" };
  const products = [
    { ...base, id: "sachet", name: "ABE Pre Workout", variantOptions: { size: "1 x Single Serving Sachet 12.5g", orderUnit: "each" } },
    { ...base, id: "tub", name: "ABE Pre Workout", variantOptions: { size: "30 Servings 250g", orderUnit: "tub" } },
    { ...base, id: "shot100", name: "ABE Pre Workout", variantOptions: { size: "12 x 100ml", orderUnit: "case" } },
    { ...base, id: "shot60", name: "ABE Pre Workout", variantOptions: { size: "12 x 60ml", orderUnit: "case" } },
    { ...base, id: "choc", name: "ABE Pre Workout", variantOptions: { size: "30 Servings 250g", flavour: "Chocolate", orderUnit: "tub" } },
  ] as any;
  const cards = groupProductFamilies(products as any, [{ id: "active:abe", organisationId: "org", name: "ABE Pre Workout", active: true, sortPosition: 0 }], "org");
  assert.equal(cards.length, 4);
  assert.ok(cards.some(card => card.variants.length === 2));
});

test("Active Sports coverage reports supplier, commerce, family and hidden counts", () => {
  const rows: DurableSupplierParentRow[] = [{ parentKey: "p", supplierId: "s", supplierName: "Active Sports", memberOrderable: true, name: "P", variants: [{ id: "v", supplierId: "s", parentKey: "p", stockStatus: "available" }] }];
  const base = { organisationId: "o", name: "P", active: true, stockTracked: false, currency: "GBP", createdAt: "", updatedAt: "" };
  const result = activeSportsCoverage(rows, [{ ...base, id: "v", supplierReference: "supplier_product:v", supplierAvailabilityStatus: "available", sellPriceMinor: 100 }, { ...base, id: "x", supplierReference: "supplier_product:x", supplierAvailabilityStatus: "unavailable", sellPriceMinor: 0 }, { ...base, id: "d", supplierReference: "supplier_product:d", supplierAvailabilityStatus: "available", sellPriceMinor: 100, active: false }], [{ id: "f", organisationId: "o", name: "P", active: true, sortPosition: 0 }]);
  assert.deepEqual(result, { supplierVariants: 1, commerceProducts: 3, families: 1, visible: 1, hiddenMissingPrice: 1, hiddenUnavailable: 1, hiddenDiscontinued: 1 });
});
