import type { Recommendation } from "./types";
import { parseRange } from "./workout";

type CoachInput = { weight: number; reps: number; rir: number; target: string; restSeconds: number; purpose?: string; previousWeight?: number; previousReps?: number; feedback?: string; };
export function getSetRecommendation(input: CoachInput): Recommendation {
  const { low, high } = parseRange(input.target); const feedback = (input.feedback || "").toLowerCase();
  const increment = input.weight >= 30 ? 2.5 : input.weight >= 10 ? 1.25 : 1;
  let restSeconds = input.restSeconds;
  if (feedback.includes("shoulder") || feedback.includes("pain")) return { title: "Protect the joint", detail: "Do not push through shoulder discomfort. Stop this movement today; use a pain-free machine press or reduce range/load.", nextWeight: input.weight, repTarget: "Pain-free only", restSeconds, tone: "reduce" };
  if (feedback.includes("brutal") || feedback.includes("fatigue")) { restSeconds += 45; return { title: "Manage fatigue", detail: "Take the extra rest. Keep the load and aim for the bottom of the range with clean technique; reducing load is better than grinding.", nextWeight: input.weight, repTarget: `${low}–${high}`, restSeconds, tone: "hold" }; }
  if (input.reps < low || input.rir <= 0) return { title: "Hold and execute", detail: "You are at or below the productive limit. Keep the load (or reduce slightly if form broke down) and earn quality reps.", nextWeight: input.weight, repTarget: `${low}–${high}`, restSeconds, tone: "hold" };
  if (input.reps >= high && input.rir >= 3) return { title: "Small progression", detail: "You reached the top of the range with room left. Add the smallest sensible increment, then work back through the range.", nextWeight: input.weight + increment, repTarget: `${low}–${high}`, restSeconds, tone: "progress" };
  if (input.reps >= high && input.rir <= 2) return { title: "Keep the load", detail: "Top-of-range reps at the right effort are productive. Keep this weight next set and make the reps cleaner before adding load.", nextWeight: input.weight, repTarget: `${low}–${high}`, restSeconds, tone: "hold" };
  return { title: "Add quality reps", detail: "Stay at this load and aim for one more controlled rep if it is there. No need to force a jump yet.", nextWeight: input.weight, repTarget: `${low}–${high}`, restSeconds, tone: "hold" };
}

export function cardioRecommendation(workingSets: number, difficultSets: number) { if (difficultSets >= 5) return { duration: 12, incline: 6, speed: 4.8, why: "Weights were demanding, so keep conditioning recovery-friendly." }; if (workingSets >= 16) return { duration: 16, incline: 8, speed: 5, why: "A moderate finish supports conditioning without turning today into maximal cardio." }; return { duration: 20, incline: 8, speed: 5, why: "The weights session left room for a steady conditioning block." }; }
