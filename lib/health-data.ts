export type HealthProviderId = "whoop" | "apple_health" | "health_connect" | "garmin" | "fitbit" | "oura" | "samsung_health" | "polar" | "suunto" | "withings" | "manual";
export type HealthMetric = "sleep_duration" | "sleep_quality" | "sleep_need" | "sleep_consistency" | "hrv" | "resting_heart_rate" | "heart_rate" | "respiratory_rate" | "blood_oxygen" | "steps" | "active_energy" | "total_energy" | "workout" | "training_load" | "readiness_score" | "body_weight" | "body_fat" | "body_composition";
export type HealthUnit = "hours" | "percent" | "milliseconds" | "bpm" | "breaths_per_minute" | "percent_spo2" | "count" | "kcal" | "load" | "kg" | "workout" | "json";
export type HealthProvenance = { provider: HealthProviderId; sourceDevice?: string; providerRecordId?: string; measuredAt: string; importedAt: string; freshness: "current" | "delayed" | "stale" | "unknown"; kind: "measured" | "provider_derived" | "manual" };
export type NormalizedHealthRecord = { id: string; userId?: string; metric: HealthMetric; value: number | string | Record<string, unknown>; unit: HealthUnit; provenance: HealthProvenance };
export type HealthProviderCapability = { id: HealthProviderId; label: string; metrics: HealthMetric[]; connection: "oauth" | "system_permission" | "manual"; aggregator?: boolean };
export type HealthConnectionState = "connected" | "disconnected" | "requires_reauthentication" | "syncing" | "stale" | "error";
export type HealthConnection = { provider: HealthProviderId; state: HealthConnectionState; capabilities: HealthMetric[]; grantedPermissions?: string[]; lastSuccessfulSync?: string; error?: string };

export const healthProviders: HealthProviderCapability[] = [
  { id: "whoop", label: "WHOOP", metrics: ["readiness_score", "sleep_quality", "hrv", "resting_heart_rate", "training_load", "workout"], connection: "oauth" },
  { id: "apple_health", label: "Apple Health", metrics: ["sleep_duration", "sleep_quality", "hrv", "resting_heart_rate", "heart_rate", "steps", "active_energy", "body_weight", "workout"], connection: "system_permission", aggregator: true },
  { id: "health_connect", label: "Health Connect", metrics: ["sleep_duration", "hrv", "resting_heart_rate", "heart_rate", "steps", "active_energy", "body_weight", "workout"], connection: "system_permission", aggregator: true },
  { id: "garmin", label: "Garmin", metrics: ["sleep_duration", "sleep_quality", "hrv", "resting_heart_rate", "steps", "active_energy", "training_load", "workout"], connection: "oauth" },
  { id: "fitbit", label: "Fitbit", metrics: ["sleep_duration", "sleep_quality", "resting_heart_rate", "heart_rate", "steps", "active_energy", "workout"], connection: "oauth" },
  { id: "oura", label: "Oura", metrics: ["sleep_duration", "sleep_quality", "sleep_need", "sleep_consistency", "hrv", "resting_heart_rate", "readiness_score"], connection: "oauth" },
  { id: "samsung_health", label: "Samsung Health", metrics: ["sleep_duration", "heart_rate", "steps", "active_energy", "body_weight", "workout"], connection: "oauth" },
  { id: "polar", label: "Polar", metrics: ["sleep_duration", "resting_heart_rate", "heart_rate", "training_load", "workout"], connection: "oauth" },
  { id: "suunto", label: "Suunto", metrics: ["sleep_duration", "heart_rate", "training_load", "workout"], connection: "oauth" },
  { id: "withings", label: "Withings", metrics: ["body_weight", "body_fat", "body_composition"], connection: "oauth" },
  { id: "manual", label: "R12 check-in", metrics: ["body_weight", "workout"], connection: "manual" }
];

export function healthRecordFreshness(measuredAt: string, now = new Date()): HealthProvenance["freshness"] { const age = now.getTime() - new Date(measuredAt).getTime(); if (!Number.isFinite(age) || age < 0) return "unknown"; if (age <= 36 * 60 * 60 * 1000) return "current"; if (age <= 7 * 86400000) return "delayed"; return "stale"; }
export function normalizeWhoopHealthData(input: Record<string, any>, now = new Date()): NormalizedHealthRecord[] {
  const timestamp = String(input.created_at ?? input.updated_at ?? input.start ?? now.toISOString()); const providerRecordId = String(input.cycle_id ?? input.id ?? ""); const score = input.score ?? {}; const values: Array<[HealthMetric, number | undefined, HealthUnit, "measured" | "provider_derived"]> = [
    ["readiness_score", input._recoveryScore ?? score.recovery_score, "percent", "provider_derived"], ["sleep_quality", input._sleepPerformance ?? input.sleep_performance_percentage ?? score.sleep_performance_percentage ?? input.sleep?.score?.sleep_performance_percentage ?? input.sleep?.sleep_performance_percentage, "percent", "provider_derived"], ["hrv", input._recoveryHrv ?? score.hrv_ms, "milliseconds", "measured"], ["resting_heart_rate", input._recoveryRestingHeartRate ?? (score.resting_heart_rate_milli ? score.resting_heart_rate_milli / 1000 : score.resting_heart_rate), "bpm", "measured"], ["training_load", input._cycleStrain ?? input.strain ?? score.strain, "load", "provider_derived"]
  ];
  return values.filter((entry): entry is [HealthMetric, number, HealthUnit, "measured" | "provider_derived"] => typeof entry[1] === "number" && Number.isFinite(entry[1])).map(([metric, value, unit, kind]) => ({ id: `${providerRecordId || "whoop"}:${metric}:${timestamp}`, metric, value, unit, provenance: { provider: "whoop", providerRecordId: providerRecordId || undefined, measuredAt: timestamp, importedAt: now.toISOString(), freshness: healthRecordFreshness(timestamp, now), kind } }));
}

export function deduplicateHealthRecords(records: NormalizedHealthRecord[]): NormalizedHealthRecord[] { const byEvent = new Map<string, NormalizedHealthRecord>(); const priority = (provider: HealthProviderId) => provider === "manual" ? 4 : provider === "apple_health" || provider === "health_connect" ? 1 : 3; for (const record of records) { const key = `${record.metric}:${record.provenance.measuredAt}:${JSON.stringify(record.value)}`; const existing = byEvent.get(key); if (!existing || priority(record.provenance.provider) > priority(existing.provenance.provider)) byEvent.set(key, record); } return [...byEvent.values()]; }
