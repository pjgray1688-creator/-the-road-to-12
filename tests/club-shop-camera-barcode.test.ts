import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/club-shop.tsx", "utf8");
test("camera passes BarcodeDetector rawValue to the shared resolver", () => {
  assert.match(source, /const resolveBarcode\s*=\s*\(raw: string\)/);
  assert.match(source, /const scan\s*=\s*\(raw\?: unknown\).*resolveBarcode\(typeof raw === "string" \? raw : barcode\)/s);
  assert.match(source, /const value = found\[0\]\?\.rawValue; if \(value\) \{ scan\(value\);/s);
  assert.match(source, /cameraStream\.current\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
});

