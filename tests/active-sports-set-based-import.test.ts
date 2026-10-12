import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-11-12-active-sports-set-based-import.sql'),
  'utf8',
);
const forwardFix = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-12-16-active-sports-import-update-scope-fix.sql'),
  'utf8',
);
const manualPriceLinkFix = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-12-17-active-sports-link-manual-price-fix.sql'),
  'utf8',
);
const manualPricePropagationFix = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-12-18-active-sports-manual-price-propagation.sql'),
  'utf8',
);
const supplierPriceGuardFix = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-12-19-supplier-authoritative-canonical-price-guard.sql'),
  'utf8',
);
const generatedPricePropagationFix = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-12-20-active-sports-generated-price-propagation.sql'),
  'utf8',
);
const commerceLinkPerformanceFix = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-12-21-active-sports-commerce-link-performance.sql'),
  'utf8',
);
const postgresHarness = fs.readFileSync(
  path.join(process.cwd(), 'scripts/validate-coach-nutrition-reconciliation-postgres.sh'),
  'utf8',
);
const postgresWorkflow = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/validate-migrations-postgres.yml'),
  'utf8',
);
const postgresImportTest = fs.readFileSync(
  path.join(process.cwd(), 'tests/sql/active-sports-import-v2.sql'),
  'utf8',
);
const deploymentManifest = fs.readFileSync(
  path.join(process.cwd(), 'supabase/deployment/2026-11-22-madhouse-launch-migrations.txt'),
  'utf8',
);

test('Active Sports importer stages JSON rows once and bulk upserts parents and variants', () => {
    assert.match(migration, /jsonb_array_elements\(p_rows\) with ordinality/i);
    assert.match(migration, /create temporary table _active_sports_rows/i);
    assert.match(migration, /insert into public\.club_supplier_parent_products[\s\S]*select distinct on/i);
    assert.match(migration, /update public\.club_supplier_products[\s\S]*from _active_sports_resolved/i);
    assert.match(migration, /insert into public\.club_supplier_products[\s\S]*select[\s\S]*from _active_sports_resolved/i);
    assert.doesNotMatch(migration, /for v_row in select value from jsonb_array_elements/i);
    assert.doesNotMatch(migration, /select \* into v_offer from public\.club_supplier_products/i);
});

test('keeps canonical variant facts, commercial fields, images and organisation scope', () => {
    for (const field of ['import_identity', 'brand', 'variant', 'size', 'pack_quantity', 'member_orderable_unit', 'trade_cost_ex_vat_minor', 'supplied_vat_rate', 'variant_image_url', 'availability_status']) {
      assert.match(migration, new RegExp(field));
    }
    assert.match(migration, /sp\.organisation_id=p_organisation_id/);
    assert.match(migration, /sp\.supplier_id=v_supplier\.id/);
    assert.doesNotMatch(migration, /club_stock_movements|club_adjust_inventory|club_inventory/i);
});

test('is shaped for large, repeatable imports without a per-row lookup', () => {
    const rows = Array.from({ length: 3200 }, (_, i) => ({
      name: `Variant ${i}`,
      brand: `Brand ${i % 400}`,
      parentKey: `parent-${i % 851}`,
      flavour: `Flavour ${i % 8}`,
      size: i % 2 ? '900g' : '1.8kg',
      packQuantity: '1',
      memberOrderableUnit: 'unit',
      tradeCostExVatMinor: '1000',
      suppliedVatRate: '0.2',
      availabilityStatus: 'available',
    }));
    assert.equal(rows.length, 3200);
    assert.ok((migration.match(/jsonb_array_elements\(p_rows\)/g) ?? []).length <= 2);
    assert.match(migration, /on conflict \(organisation_id, supplier_id, parent_key\)/);
});

test('retains unavailable rows without writing local inventory', () => {
    assert.match(migration, /availability_status=r\.availability_status/);
    assert.match(migration, /discontinued=r\.discontinued/);
    assert.doesNotMatch(migration, /insert into public\.club_stock_movements/);
});

test('forward importer fix keeps the update target out of JOIN ON scope', () => {
    assert.match(forwardFix, /update public\.club_supplier_products sp[\s\S]*from _active_sports_resolved r, _active_sports_matches m\s+where m\.identity_key=r\.identity_key\s+and m\.supplier_product_id=sp\.id/);
    assert.doesNotMatch(forwardFix, /join _active_sports_matches m on[^;]*sp\.id/i);
    assert.match(forwardFix, /security definer\s+set search_path=pg_catalog,public/i);
    assert.match(forwardFix, /revoke all on function public\.club_import_supplier_catalogue_v2\(uuid,text,text,jsonb,boolean\) from public, anon/i);
    assert.match(forwardFix, /grant execute on function public\.club_import_supplier_catalogue_v2\(uuid,text,text,jsonb,boolean\) to authenticated/i);
});

test('commerce linker avoids guarded price writes for manual prices and still syncs generated prices', () => {
    assert.match(manualPriceLinkFix, /update public\.club_commerce_products[\s\S]*?set family_id=f\.id[\s\S]*?updated_at=now\(\)\s+where id=cp\.id;/i);
    assert.match(manualPriceLinkFix, /if not sp\.manual_price[\s\S]*?update public\.club_supplier_products\s+set updated_at=now\(\)/i);
    assert.doesNotMatch(manualPriceLinkFix, /update public\.club_commerce_products[\s\S]*?set[^;]*sell_price_minor/i);
    assert.match(manualPriceLinkFix, /case when sp\.manual_price then sp\.retail_price_minor else v_price end/i);
    assert.match(manualPriceLinkFix, /supplier row so its existing commercial[\s\S]*?sync triggers can update the linked product/i);
    assert.match(manualPriceLinkFix, /security definer\s+set search_path=pg_catalog,public/i);
    assert.match(manualPriceLinkFix, /revoke all on function public\.club_link_supplier_catalogue_to_commerce\(uuid,text\) from public,anon/i);
    assert.match(manualPriceLinkFix, /grant execute on function public\.club_link_supplier_catalogue_to_commerce\(uuid,text\) to authenticated/i);
    assert.doesNotMatch(manualPriceLinkFix, /club_supplier_canonical_price_changed|drop trigger|disable trigger/i);
});

test('approved supplier pricing propagates to the linked canonical product through the guarded RPC', () => {
    assert.match(manualPricePropagationFix, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'commerce\.pricing_manage'\)/i);
    assert.match(manualPricePropagationFix, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'supplier\.catalogue_manage'\)/i);
    assert.match(manualPricePropagationFix, /select \* into o[\s\S]*organisation_id=p_organisation_id[\s\S]*for update/i);
    assert.match(manualPricePropagationFix, /update public\.club_supplier_products[\s\S]*retail_price_minor=p_retail_price_minor,manual_price=true/i);
    assert.match(manualPricePropagationFix, /update public\.club_supplier_products[\s\S]*set updated_at=clock_timestamp\(\)/i);
    assert.match(manualPricePropagationFix, /Supplier commercial-audit trigger propagates the authoritative/i);
    assert.doesNotMatch(manualPricePropagationFix, /update public\.club_commerce_products[\s\S]*set sell_price_minor/i);
    assert.doesNotMatch(manualPricePropagationFix, /cost_price_minor\s+is\s+null/i);
    assert.match(manualPricePropagationFix, /if o\.manual_price and o\.retail_price_minor=p_retail_price_minor then[\s\S]*v_unchanged:=true/i);
    assert.match(manualPricePropagationFix, /revoke all on function public\.club_set_supplier_variant_retail_price\(uuid,uuid,integer,boolean\) from public,anon/i);
    assert.match(manualPricePropagationFix, /grant execute on function public\.club_set_supplier_variant_retail_price\(uuid,uuid,integer,boolean\) to authenticated/i);
});

test('supplier audit propagates generated and manual prices without filtering populated supplier cost', () => {
    assert.match(generatedPricePropagationFix, /security definer\s+set search_path=pg_catalog,public/i);
    assert.match(generatedPricePropagationFix, /if new\.import_identity is not null then[\s\S]*insert into public\.club_supplier_variant_costs/i);
    assert.match(generatedPricePropagationFix, /if new\.club_product_id is not null and new\.retail_price_minor is not null then[\s\S]*update public\.club_commerce_products as cp/i);
    assert.match(generatedPricePropagationFix, /cp\.id=new\.club_product_id[\s\S]*cp\.organisation_id=new\.organisation_id[\s\S]*cp\.supplier_reference='supplier_product:'\|\|new\.id::text/i);
    assert.match(generatedPricePropagationFix, /not cp\.stock_tracked[\s\S]*cp\.service_id is null/i);
    assert.match(generatedPricePropagationFix, /set sell_price_minor=new\.retail_price_minor[\s\S]*active=new\.sellable/i);
    assert.doesNotMatch(generatedPricePropagationFix, /cost_price_minor\s+is\s+null|disable trigger|drop trigger|set_config|current_setting/i);
    assert.match(generatedPricePropagationFix, /revoke all on function public\.club_supplier_commercial_audit\(\) from public,anon,authenticated/i);
});

test('full-catalogue commerce linker uses staged set-based work and narrow changed-row updates', () => {
    assert.match(commerceLinkPerformanceFix, /security definer\s+set search_path=pg_catalog,public/i);
    assert.match(commerceLinkPerformanceFix, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'supplier\.catalogue_manage'\)/i);
    assert.match(commerceLinkPerformanceFix, /club_supplier_products_link_parent_idx[\s\S]*organisation_id,supplier_id,parent_product_id,id/i);
    assert.match(commerceLinkPerformanceFix, /club_supplier_products_linked_commerce_idx[\s\S]*organisation_id,club_product_id/i);
    assert.match(commerceLinkPerformanceFix, /club_commerce_products_supplier_reference_idx[\s\S]*organisation_id,supplier_reference/i);
    assert.match(commerceLinkPerformanceFix, /create temporary table _r12_active_sports_link_stage[\s\S]*left join lateral[\s\S]*supplier_reference='supplier_product:'\|\|sp\.id::text/i);
    assert.match(commerceLinkPerformanceFix, /insert into public\.club_product_families[\s\S]*select distinct on \(pp\.name\)/i);
    assert.match(commerceLinkPerformanceFix, /insert into public\.club_commerce_products[\s\S]*from candidates c/i);
    assert.match(commerceLinkPerformanceFix, /update public\.club_commerce_products cp[\s\S]*from pg_temp\._r12_active_sports_link_stage st/i);
    assert.match(commerceLinkPerformanceFix, /update public\.club_supplier_products sp[\s\S]*from pg_temp\._r12_active_sports_link_stage st[\s\S]*club_product_id=st\.canonical_product_id/i);
    assert.match(commerceLinkPerformanceFix, /is distinct from/);
    assert.doesNotMatch(commerceLinkPerformanceFix, /for\s+(?:pp|sp)\s+in|select \* into cp|set sell_price_minor=.*where/i);
    assert.match(commerceLinkPerformanceFix, /revoke all on function public\.club_link_supplier_catalogue_to_commerce\(uuid,text\) from public,anon/i);
    assert.match(commerceLinkPerformanceFix, /grant execute on function public\.club_link_supplier_catalogue_to_commerce\(uuid,text\) to authenticated/i);
});

test('canonical price guard permits only exact supplier-authoritative prices and rejects mismatches', () => {
    assert.match(supplierPriceGuardFix, /security definer\s+set search_path=pg_catalog,public/i);
    assert.match(supplierPriceGuardFix, /organisation_id=new\.organisation_id[\s\S]*club_product_id=new\.id[\s\S]*new\.supplier_reference='supplier_product:'\|\|club_supplier_products\.id::text[\s\S]*for share/i);
    assert.match(supplierPriceGuardFix, /new\.supplier_reference like 'supplier_product:%'[\s\S]*or exists\([\s\S]*organisation_id=new\.organisation_id and club_product_id=new\.id[\s\S]*raise exception/i);
    assert.match(supplierPriceGuardFix, /new\.stock_tracked or new\.service_id is not null[\s\S]*raise exception/i);
    assert.match(supplierPriceGuardFix, /new\.cost_price_minor is distinct from old\.cost_price_minor[\s\S]*raise exception/i);
    assert.match(supplierPriceGuardFix, /offer\.retail_price_minor is not null[\s\S]*offer\.retail_price_minor=new\.sell_price_minor[\s\S]*return new/i);
    assert.match(supplierPriceGuardFix, /if new\.cost_price_minor is not null then[\s\S]*raise exception 'Use the supplier pricing controls for this sales unit'/i);
    assert.match(supplierPriceGuardFix, /revoke all on function public\.club_supplier_canonical_price_changed\(\) from public,anon,authenticated/i);
    assert.doesNotMatch(supplierPriceGuardFix, /disable trigger|drop trigger|set_config|current_setting/i);
});

test('PostgreSQL 16 CI applies the repair and exercises the UI importer and commerce linker', () => {
    assert.match(postgresHarness, /2026-12-07-club-pos-sellable-units-and-pt-packages\.sql[\s\S]*2026-12-16-active-sports-import-update-scope-fix\.sql[\s\S]*2026-12-17-active-sports-link-manual-price-fix\.sql[\s\S]*2026-12-18-active-sports-manual-price-propagation\.sql[\s\S]*2026-12-19-supplier-authoritative-canonical-price-guard\.sql[\s\S]*2026-12-20-active-sports-generated-price-propagation\.sql[\s\S]*2026-12-21-active-sports-commerce-link-performance\.sql[\s\S]*tests\/sql\/active-sports-import-v2\.sql/);
    assert.match(postgresHarness, /2026-12-16-active-sports-import-update-scope-fix\.sql[\s\S]*2026-12-17-active-sports-link-manual-price-fix\.sql[\s\S]*2026-12-18-active-sports-manual-price-propagation\.sql[\s\S]*2026-12-19-supplier-authoritative-canonical-price-guard\.sql[\s\S]*2026-12-20-active-sports-generated-price-propagation\.sql[\s\S]*2026-12-21-active-sports-commerce-link-performance\.sql[\s\S]*tests\/sql\/active-sports-import-v2\.sql/);
    assert.match(postgresWorkflow, /image: postgres:16/);
    assert.match(deploymentManifest, /2026-12-15-coach-nutrition-reconciliation\.sql\s+supabase\/migrations\/2026-12-16-active-sports-import-update-scope-fix\.sql\s+supabase\/migrations\/2026-12-17-active-sports-link-manual-price-fix\.sql\s+supabase\/migrations\/2026-12-18-active-sports-manual-price-propagation\.sql\s+supabase\/migrations\/2026-12-19-supplier-authoritative-canonical-price-guard\.sql\s+supabase\/migrations\/2026-12-20-active-sports-generated-price-propagation\.sql\s+supabase\/migrations\/2026-12-21-active-sports-commerce-link-performance\.sql/);
    assert.match(postgresImportTest, /club_import_supplier_catalogue_v2/);
    assert.match(postgresImportTest, /club_link_supplier_catalogue_to_commerce/);
    for (const contractField of ['name', 'parentKey', 'brand', 'category', 'subcategory', 'description', 'size', 'flavour', 'supplierSku', 'barcode', 'packQuantity', 'memberOrderableUnit', 'availabilityStatus', 'availabilityCheckedAt', 'tradeCostExVatMinor', 'suppliedVatRate', 'sourceUrl', 'parentImageUrl', 'variantImageUrl', 'notes']) {
      assert.ok(postgresImportTest.includes(`"${contractField}"`), `SQL fixture should cover ${contractField}`);
    }
    assert.match(postgresImportTest, /updated_count=3/);
    assert.match(postgresImportTest, /Non-manual supplier retail expected 3600; observed %/);
    assert.match(postgresImportTest, /Generated supplier retail after repeat import expected 3600; observed %[\s\S]*Generated supplier manual flag after repeat import expected false; observed %[\s\S]*Generated canonical price immediately after repeat import expected 3600; observed %[\s\S]*club_link_supplier_catalogue_to_commerce/);
    assert.match(postgresImportTest, /Repeat linker created duplicate canonical commerce products/);
    assert.match(postgresImportTest, /club_set_supplier_variant_retail_price/);
    assert.doesNotMatch(postgresImportTest, /club_save_pos_product/);
    assert.match(postgresImportTest, /insert into public\.club_commerce_products\(id,organisation_id,sku,name,brand,category,active,stock_tracked,sell_price_minor,currency,supplier_reference\)[\s\S]*LOCAL-WHEY-001/);
    assert.match(postgresImportTest, /set_config\('r12\.active_sports_fixture_local_product_id'[\s\S]*from public\.club_commerce_products/);
    assert.match(postgresImportTest, /public\.club_adjust_inventory\(\s*p_organisation_id\s*=>[\s\S]*p_idempotency_key\s*=>\s*'active-sports-ci-stock-11'::text/i);
    assert.match(postgresImportTest, /-- The canonical guard stays active:[\s\S]*?update public\.club_commerce_products set sell_price_minor=7778[\s\S]*?Expected arbitrary canonical price update to be rejected/);
    assert.match(postgresImportTest, /set cost_price_minor=2001,sell_price_minor=8888[\s\S]*?Expected combined cost and arbitrary price update to be rejected/);
    assert.match(postgresImportTest, /active_sports_import_preservation_snapshot/);
    assert.match(postgresImportTest, /local_on_hand/);
    assert.match(postgresImportTest, /set_config\([\s\S]*?r12\.active_sports_fixture_variant_id[\s\S]*?from public\.club_supplier_products[\s\S]*?set local role authenticated/i);
    assert.match(postgresImportTest, /current_setting\('r12\.active_sports_fixture_variant_id'\)::uuid/);
    const authenticatedSections = [...postgresImportTest.matchAll(/set local role authenticated;([\s\S]*?)reset role;/gi)];
    assert.ok(authenticatedSections.length > 0);
    for (const [, section] of authenticatedSections) {
      assert.doesNotMatch(section, /\b(?:from|join|update|insert\s+into|delete\s+from)\s+public\.club_supplier_(?:products|parent_products|variant_prices|variant_costs|import_batches)/i);
    }
    assert.match(postgresImportTest, /Manual supplier retail expected 7777; observed %/);
    assert.match(postgresImportTest, /Manual supplier flag expected true; observed %/);
    assert.match(postgresImportTest, /Canonical price after manual pricing expected 7777; observed %/);
    assert.match(postgresImportTest, /cp\.cost_price_minor=2000 and cp\.sell_price_minor=3500/);
    assert.match(postgresImportTest, /arbitrary canonical price update to be rejected/);
    assert.match(postgresImportTest, /combined cost and arbitrary price update to be rejected/);
    assert.match(postgresImportTest, /supplier-matching price not to authorize a cost edit/);
    assert.match(postgresImportTest, /canonical supplier cost after manual pricing expected 2000/i);
    assert.match(postgresImportTest, /Repeat import\/link changed canonical supplier cost/i);
    assert.match(postgresImportTest, /Post-repeat canonical price % differs from post-manual snapshot %/);
    assert.ok(postgresImportTest.indexOf('club_set_supplier_variant_retail_price') < postgresImportTest.indexOf('active_sports_import_preservation_snapshot'));
    assert.match(postgresImportTest, /Non-manual canonical price expected 3600; observed %/);
    assert.match(postgresImportTest, /852 families[\s\S]*3,228 variants[\s\S]*elapsed_ms=%/);
    assert.match(postgresImportTest, /Initial 3,228-variant commerce link exceeded 10 seconds/);
    assert.match(postgresImportTest, /Repeat 3,228-variant commerce link exceeded 10 seconds/);
    assert.match(postgresImportTest, /active-sports-scale-initial\.csv[\s\S]*created_count=3228 and updated_count=0 and invalid_count=0[\s\S]*Initial 3,228-variant commerce link/);
    assert.match(postgresImportTest, /active-sports-scale-initial\.csv[\s\S]*active-sports-scale-rerun\.csv[\s\S]*created_count=0 and updated_count=3228 and invalid_count=0/);
    assert.doesNotMatch(postgresImportTest.slice(postgresImportTest.indexOf('-- Full-catalogue link scale regression')), /insert into public\.club_supplier_(?:parent_products|products)\s*\(/i);
    assert.match(postgresImportTest, /active-sports-scale-rerun\.csv/);
});
