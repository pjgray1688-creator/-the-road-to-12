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

test('PostgreSQL 16 CI applies the repair and exercises the UI importer and commerce linker', () => {
    assert.match(postgresHarness, /2026-12-16-active-sports-import-update-scope-fix\.sql[\s\S]*tests\/sql\/active-sports-import-v2\.sql/);
    assert.match(postgresWorkflow, /image: postgres:16/);
    assert.match(deploymentManifest, /2026-12-15-coach-nutrition-reconciliation\.sql\s+supabase\/migrations\/2026-12-16-active-sports-import-update-scope-fix\.sql/);
    assert.match(postgresImportTest, /club_import_supplier_catalogue_v2/);
    assert.match(postgresImportTest, /club_link_supplier_catalogue_to_commerce/);
    for (const contractField of ['name', 'parentKey', 'brand', 'category', 'subcategory', 'description', 'size', 'flavour', 'supplierSku', 'barcode', 'packQuantity', 'memberOrderableUnit', 'availabilityStatus', 'availabilityCheckedAt', 'tradeCostExVatMinor', 'suppliedVatRate', 'sourceUrl', 'parentImageUrl', 'variantImageUrl', 'notes']) {
      assert.ok(postgresImportTest.includes(`"${contractField}"`), `SQL fixture should cover ${contractField}`);
    }
    assert.match(postgresImportTest, /updated_count=3/);
    assert.match(postgresImportTest, /club_set_supplier_variant_retail_price/);
    assert.match(postgresImportTest, /club_save_pos_product/);
    assert.match(postgresImportTest, /club_adjust_inventory/);
    assert.doesNotMatch(postgresImportTest, /update public\.club_commerce_products set sell_price_minor|update public\.club_commerce_products set stock_tracked/i);
    assert.match(postgresImportTest, /active_sports_import_preservation_snapshot/);
    assert.match(postgresImportTest, /local_on_hand/);
    assert.match(postgresImportTest, /set_config\([\s\S]*?r12\.active_sports_fixture_variant_id[\s\S]*?from public\.club_supplier_products[\s\S]*?set local role authenticated/i);
    assert.match(postgresImportTest, /current_setting\('r12\.active_sports_fixture_variant_id'\)::uuid/);
    const authenticatedSections = [...postgresImportTest.matchAll(/set local role authenticated;([\s\S]*?)reset role;/gi)];
    assert.ok(authenticatedSections.length > 0);
    for (const [, section] of authenticatedSections) {
      assert.doesNotMatch(section, /\b(?:from|join|update|insert\s+into|delete\s+from)\s+public\.club_supplier_(?:products|parent_products|variant_prices|variant_costs|import_batches)/i);
    }
    assert.match(postgresImportTest, /management-approved retail price/);
});
