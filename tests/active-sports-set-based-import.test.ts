import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/2026-11-12-active-sports-set-based-import.sql'),
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
