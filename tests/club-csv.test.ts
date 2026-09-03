import assert from "node:assert/strict";
import test from "node:test";
import { parseClubCsv } from "../lib/club-csv";

test("catalogue CSV parser preserves quoted commas and barcode strings", () => {
  const rows = parseClubCsv('name,category,price,barcode,sku,stockTracked,active,notes\n"Creatine Gummies",Creatine,15.00,00505655207376,,true,true,"Blackcurrant, 80 gummies"');
  assert.equal(rows[0]?.barcode, "00505655207376");
  assert.equal(rows[0]?.notes, "Blackcurrant, 80 gummies");
});

test("Collagen remains review required", () => {
  const row = parseClubCsv("name,category,price,barcode,sku,stockTracked,active\nCollagen,Health, ,,,true,false")[0];
  assert.equal(row?.status, "REVIEW REQUIRED");
  assert.match(row?.reason ?? "", /2 for £20/);
});
