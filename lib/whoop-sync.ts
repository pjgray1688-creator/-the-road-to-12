import type { RecoverySnapshot } from "./domain";

export function shouldSyncReadiness(status: { connected?: boolean; lastSyncAt?: string; latest?: RecoverySnapshot | null }, now = Date.now(), staleMs = 6 * 60 * 60 * 1000) {
  if (!status.connected) return false;
  const latest = status.latest;
  if (!latest || latest.sleepPerformance === undefined || latest.strain === undefined) return true;
  if (!status.lastSyncAt) return true;
  const syncedAt = Date.parse(status.lastSyncAt);
  return !Number.isFinite(syncedAt) || now - syncedAt > staleMs;
}
