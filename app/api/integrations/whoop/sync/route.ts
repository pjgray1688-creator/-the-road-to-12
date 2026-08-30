import { NextResponse } from "next/server";
import { accessToken, markSynced, normalizeWhoop, persistRecords } from "@/lib/whoop-server";
import { serverSupabase } from "@/lib/supabase-server";
export async function POST() {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const token = await accessToken(user.id);
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 7 * 86400000).toISOString();
    const headers = { Authorization: `Bearer ${token}` };
    const query = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=25`;
    const [recoveryResponse, sleepResponse, cycleResponse] = await Promise.all([
      fetch(`https://api.prod.whoop.com/developer/v2/recovery?${query}`, { headers }),
      fetch(`https://api.prod.whoop.com/developer/v2/activity/sleep?${query}`, { headers }),
      fetch(`https://api.prod.whoop.com/developer/v2/cycle?${query}`, { headers }),
    ]);
    if (!recoveryResponse.ok) return NextResponse.json({ error: `WHOOP sync failed (${recoveryResponse.status})` }, { status: recoveryResponse.status });
    const recovery = await recoveryResponse.json();
    const sleep = sleepResponse.ok ? await sleepResponse.json() : { records: [] };
    const cycles = cycleResponse.ok ? await cycleResponse.json() : { records: [] };
    const merged = new Map<string, any>();
    for (const item of recovery.records ?? []) merged.set(String(item.cycle_id ?? item.id), { ...item, _recoveryScore: item.score?.recovery_score, _recoveryHrv: item.score?.hrv_ms, _recoveryRestingHeartRate: item.score?.resting_heart_rate_milli ? item.score.resting_heart_rate_milli / 1000 : item.score?.resting_heart_rate });
    for (const item of cycles.records ?? []) { const key = String(item.id); const existing = merged.get(key) ?? {}; merged.set(key, { ...existing, _cycleStrain: item.score?.strain ?? item.strain, start: existing.start ?? item.start, created_at: existing.created_at ?? item.created_at }); }
    for (const item of sleep.records ?? []) { const key = String(item.cycle_id ?? item.id); const existing = merged.get(key) ?? {}; merged.set(key, { ...existing, _sleepPerformance: item.score?.sleep_performance_percentage, start: existing.start ?? item.start, created_at: existing.created_at ?? item.created_at }); }
    const snapshots = [...merged.values()].map(normalizeWhoop);
    await persistRecords(user.id, snapshots);
    const syncedAt = await markSynced(user.id);
    return NextResponse.json({ syncedAt, snapshots });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "WHOOP sync failed" }, { status: 401 }); }
}
