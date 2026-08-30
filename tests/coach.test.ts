import assert from "node:assert/strict";
import test from "node:test";
import { getSetRecommendation, cardioRecommendation } from "../lib/coach";

test("Coach progresses only top-range work with sufficient RIR", () => {
  const rec = getSetRecommendation({ weight: 40, reps: 10, rir: 3, target: "4 × 8–10", restSeconds: 120 });
  assert.equal(rec.tone, "progress"); assert.equal(rec.nextWeight, 42.5);
});
test("Coach holds at an appropriate top-range effort", () => {
  const rec = getSetRecommendation({ weight: 40, reps: 10, rir: 2, target: "4 × 8–10", restSeconds: 120 });
  assert.equal(rec.tone, "hold"); assert.equal(rec.nextWeight, 40);
});
test("Fatigue increases rest rather than forcing progression", () => {
  const rec = getSetRecommendation({ weight: 40, reps: 8, rir: 1, target: "4 × 8–10", restSeconds: 120, feedback: "That was brutal" });
  assert.equal(rec.restSeconds, 165); assert.equal(rec.tone, "hold");
});
test("Cardio remains recovery-aware after difficult work", () => assert.equal(cardioRecommendation(18, 5).duration, 12));
