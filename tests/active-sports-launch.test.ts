import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTIVE_SPORTS_HEADERS, prepareActiveSportsImport, supplierPricing, parseActiveSportsCommercialFields, durableSupplierRowsToProducts, supplierVariantOrderable, activeSportsIdentity, type DurableSupplierParentRow } from "../lib/club-supplier-catalogue";
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
  assert.match(action, /diagnostic: detail/);
  assert.match(action, /summary: parsed\.summary/);
  assert.match(action, /identityKey/);
  assert.doesNotMatch(action, /The catalogue contains conflicting or incomplete identities/);
  const panel = readFileSync("components/club-supplier-pricing.tsx", "utf8");
  assert.match(panel, /Validation diagnostics/);
  assert.match(panel, /CSV rows/);
  assert.match(panel, /Identity key/);
  assert.match(action, /duplicateGroups/);
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
