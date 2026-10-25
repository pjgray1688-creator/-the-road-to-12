import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path: string) => readFileSync(path, "utf8");
test("Coach green controls remain scoped to the Coach shell", () => {
  const css = read("components/coach-product-shell.module.css");
  assert.match(css, /--lime:var\(--coach-green\)/);
  assert.doesNotMatch(css, /rgba\(168,85,247|rgba\(155,77,255|#9b4dff|#8b69c4/i);
  assert.match(css, /coach-programme-block\.selected/);
  assert.match(css, /coach-nutrition-page select:focus/);
  assert.match(css, /outline:2px solid var\(--coach-green\)/);
});
test("Coach selected dates are green while standard Club calendar styles are unchanged", () => {
  const css = read("components/club-schedule-calendar.module.css");
  assert.match(css, /\.coachMode \.dateCell\.selected\{[^}]*#55ee7b/);
  const standard = css.split(/\r?\n/).filter(line => !line.startsWith(".coachMode")).join("\n").replace(/\n$/, "");
  assert.equal(createHash("sha256").update(standard).digest("hex"), "a9a45f279972b82d68bdc153f4d69f1d006582f5d5239b12ec46cc5d6a0b823a");
});
test("Coach reviewer pages omit redundant micro-headings and retain disclosure", () => {
  const demo = read("components/coach-reviewer-demo.tsx");
  assert.doesNotMatch(demo, />CLIENTS · SYNTHETIC<\/span><h1|>COACH DIARY · SYNTHETIC<\/span><h1|>PROGRAMMES · SYNTHETIC<\/span><h1|>NUTRITION · SYNTHETIC<\/span><h1|>COACH ACCOUNT<\/span><h1/);
  assert.match(demo, /About this demonstration/);
});
