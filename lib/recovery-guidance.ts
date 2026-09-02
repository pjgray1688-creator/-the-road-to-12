import type { RecoverySnapshot } from "./domain";

export type RecoveryGuidance = { band: "low" | "caution" | "moderate" | "good" | "strong" | "unknown"; message: string; todayScore?: number; yesterdayScore?: number; trend?: "improving" | "declining" | "steady" };

const previousDate = (date: string) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); };

/** Deterministic, explainable guidance using the available WHOOP history only. */
export function recoveryGuidance(snapshots: RecoverySnapshot[], today: string, explicit?: RecoverySnapshot | null): RecoveryGuidance {
  const records = snapshots.filter(item => item.source === "whoop" && item.recoveryScore !== undefined).sort((a, b) => `${a.date}${a.providerTimestamp ?? ""}`.localeCompare(`${b.date}${b.providerTimestamp ?? ""}`));
  const current = explicit?.recoveryScore !== undefined ? explicit : records.find(item => item.date === today);
  const score = current?.recoveryScore;
  if (score === undefined) return { band: "unknown", message: "No recovery score is available today. Use your planned effort and adjust by feel." };
  const yesterdayScore = records.find(item => item.date === previousDate(today))?.recoveryScore;
  const prior = records.filter(item => item.date < today).slice(-3).map(item => item.recoveryScore!).filter(value => value !== undefined);
  const baseline = yesterdayScore ?? (prior.length ? prior.reduce((sum, value) => sum + value, 0) / prior.length : undefined);
  const trend = baseline === undefined ? undefined : score - baseline >= 10 ? "improving" : score - baseline <= -10 ? "declining" : "steady";
  const trendNote = trend === "improving" && score < 70 ? " Recovery is moving in the right direction. Keep today controlled." : trend === "declining" && score >= 50 ? " Recovery has dipped from your recent level, so keep intensity measured." : "";
  if (score <= 33) return { band: "low", message: "Recovery is low today. Reduce training demand and prioritise recovery.", todayScore: score, yesterdayScore, trend };
  if (score <= 49) return { band: "caution", message: "Recovery is limited today. Train with deliberately reduced intensity.", todayScore: score, yesterdayScore, trend };
  if (score <= 69) return { band: "moderate", message: `Recovery is moderate today. Train with controlled intensity.${trendNote}`, todayScore: score, yesterdayScore, trend };
  if (score <= 79) return { band: "good", message: `Recovery is good today. A normal productive session is appropriate.${trendNote}`, todayScore: score, yesterdayScore, trend };
  return { band: "strong", message: "Recovery is strong today. You’re ready to perform.", todayScore: score, yesterdayScore, trend };
}
