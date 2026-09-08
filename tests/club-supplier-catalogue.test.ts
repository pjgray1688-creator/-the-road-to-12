import test from "node:test";
import assert from "node:assert/strict";
import { cleanSupplierProductName, groupSupplierCatalogue, parseSupplierCatalogueRows, type ClubSupplier } from "../lib/club-supplier-catalogue";

const supplier: ClubSupplier = { id: "active-sports", name: "Active Sports Nutrition", memberOrderable: true, catalogueUrl: "https://example.invalid/catalogue" };
test("supplier import contract groups real variants under one clean parent", () => {
  const rows = parseSupplierCatalogueRows("name,brand,variant,size,pack_quantity,supplier_sku,availability\nABE RTD | SPECIAL OFFER,Applied Nutrition,Blue Lagoon,case,12,ABE-BLUE,available\nABE RTD,Applied Nutrition,Candy Ice Blast,case,12,ABE-CANDY,unknown", supplier);
  const products = groupSupplierCatalogue(rows, supplier);
  assert.equal(products.length, 1); assert.equal(products[0].name, "ABE RTD"); assert.equal(products[0].variants.length, 2); assert.equal(products[0].variants[0].packQuantity, 12);
});
test("supplier import does not require price and strips promotional boilerplate", () => {
  const rows = parseSupplierCatalogueRows("product,supplier_sku,availability\nCreatine Gummies,CG-1,unavailable", supplier);
  assert.equal(rows[0].name, "Creatine Gummies"); assert.equal("price" in rows[0], false); assert.equal(cleanSupplierProductName("Whey — FREE SHAKER"), "Whey");
});
