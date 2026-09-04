import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../supabase/migrations/2026-09-22-club-supplier-commerce.sql", import.meta.url), "utf8");
test("receiving contract protects receipts, allocations and readiness", () => { for (const term of ["club_supplier_receipts", "club_supplier_receipt_lines", "club_supplier_allocations", "club_receive_supplier_delivery", "club_allocate_supplier_units", "Receipt exceeds ordered quantity", "Allocation exceeds available quantity", "order_ready_for_collection"]) assert.ok(sql.includes(term), `missing ${term}`); });
