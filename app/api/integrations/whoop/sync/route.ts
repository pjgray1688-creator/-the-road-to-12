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
    for (const item of recovery.records ?? []) merged.set(String(item.cycle_id ?? item.id), { ...item });
    for (const item of cycles.records ?? []) { const key = String(item.id); merged.set(key, { ...(merged.get(key) ?? {}), ...item }); }
    for (const item of sleep.records ?? []) { const key = String(item.cycle_id ?? item.id); merged.set(key, { ...(merged.get(key) ?? {}), sleep: item }); }
    const snapshots = [...merged.values()].map(normalizeWhoop);
    await persistRecords(user.id, snapshots);
    const syncedAt = await markSynced(user.id);
    return NextResponse.json({ syncedAt, snapshots });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "WHOOP sync failed" }, { status: 401 }); }
}
