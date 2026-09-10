import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Products & Pricing is a management-only Club navigation destination", () => {
  const source = readFileSync("components/club-shell.tsx", "utf8");
  assert.match(source, /\[\"Products & Pricing\", `\/club\/products\$\{query\(\)\}`\]/);
  assert.match(source, /admin \? \[\[\"Products & Pricing\"/);
  assert.match(source, /pathname\.startsWith\(\"\/club\/products\"\) \? \"Products & Pricing\"/);
});
