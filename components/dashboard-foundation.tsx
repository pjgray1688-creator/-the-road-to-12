"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { assessReadiness } from "@/lib/adaptive-coach";
import { currentBlock, currentWeek, latestWhoopSnapshot, type SessionStatus } from "@/lib/domain";
import { loadData, saveData } from "@/lib/storage";
import { dayLabel, resolveToday, upcomingAfterToday } from "@/lib/schedule";

export function DashboardFoundation() {
  const router = useRouter();
  const [data, setData] = useState(() => loadData());
  const [whoop, setWhoop] = useState<{ configured?: boolean; connected?: boolean; syncedAt?: string; error?: string }>({});
  const [syncing, setSyncing] = useState(false);
  const [timezone] = useState(() => data.timezone ?? (typeof window === "undefined" ? "Europe/London" : (Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London")));
  const today = resolveToday(currentWeek, timezone);
  const latest = latestWhoopSnapshot(data.recoverySnapshots ?? []);
  const snapshot = latest?.record;
  // Persist the detected zone once; the value remains user-scoped and can be overridden later.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const detected = data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Europe/London"; if (!data.timezone) saveData({ ...data, timezone: detected }); fetch("/api/integrations/whoop/status").then(response => response.json()).then(setWhoop).catch(() => undefined); }, []);
  const addRecovery = () => { const values = ["Energy", "Sleep quality", "Muscle soreness", "Motivation", "General fatigue"].map(label => Number(window.prompt(`${label} (1–5)`))); if (values.some(value => !Number.isFinite(value) || value < 1 || value > 5)) return; const next = { ...data, recoverySnapshots: [...(data.recoverySnapshots ?? []), { id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10), origin: "real" as const, source: "manual" as const, userReported: true, energy: values[0], sleepQuality: values[1], soreness: values[2], motivation: values[3], fatigue: values[4] }] }; saveData(next); setData(next); };
  const updateStatus = (id: string, status: SessionStatus) => { const note = window.prompt("Optional note") ?? undefined; const next = { ...data, sessionStatusOverrides: { ...(data.sessionStatusOverrides ?? {}), [id]: { status, note } } }; saveData(next); setData(next); };
  const sync = async () => { setSyncing(true); setWhoop(value => ({ ...value, error: undefined })); try { const response = await fetch("/api/integrations/whoop/sync", { method: "POST" }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "WHOOP sync failed"); if (result.snapshots?.length) { const next = { ...data, recoverySnapshots: [...(data.recoverySnapshots ?? []), ...result.snapshots] }; saveData(next); setData(next); } setWhoop(value => ({ ...value, connected: true, syncedAt: result.syncedAt })); } catch (error) { setWhoop(value => ({ ...value, error: error instanceof Error ? error.message : "WHOOP sync failed" })); } finally { setSyncing(false); } };
  const disconnect = async () => { await fetch("/api/integrations/whoop/disconnect", { method: "POST" }); setWhoop(value => ({ ...value, connected: false })); };
  const readiness = assessReadiness({ recovery: snapshot });
  const statusLabel = readiness.level === "READY" ? "Ready to train normally" : readiness.level === "TRAIN WITH CAUTION" ? "Train with caution today" : "Recovery is the priority today";
  return <>
    <section className="card dashboard readiness-card" aria-label="Readiness"><span className="eyebrow">READINESS</span><strong>{readiness.level}</strong><p>{statusLabel}</p>
      <div className="whoop-heading"><span className="eyebrow">WHOOP · {whoop.connected ? "CONNECTED" : "NOT CONNECTED"}</span>{whoop.connected && snapshot && <small>{latest.isToday ? "Synced today" : `Provider date ${snapshot.date}`}</small>}</div>
      {whoop.connected && snapshot ? <><div className="whoop-metrics">{snapshot.recoveryScore !== undefined && <span><b>Recovery</b><strong>{snapshot.recoveryScore}%</strong></span>}{snapshot.sleepPerformance !== undefined && <span><b>Sleep</b><strong>{snapshot.sleepPerformance}%</strong></span>}{snapshot.strain !== undefined && <span><b>Strain</b><strong>{snapshot.strain}</strong></span>}{snapshot.hrv !== undefined && <span><b>HRV</b><strong>{snapshot.hrv} ms</strong></span>}{snapshot.restingHeartRate !== undefined && <span><b>Resting HR</b><strong>{snapshot.restingHeartRate} bpm</strong></span>}</div>{!latest.isToday && <small>No WHOOP recovery available for today yet.</small>}</> : <p>{whoop.connected ? "No WHOOP recovery available for today yet." : "Connect WHOOP to see recovery, sleep and strain."}</p>}
      {whoop.error && <p className="error-text">{whoop.error}</p>}{whoop.connected ? <><button className="secondary" onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync"}</button><button className="text-button" onClick={disconnect}>Disconnect</button></> : <button className="secondary" onClick={() => router.push("/api/integrations/whoop/authorize")} disabled={whoop.configured === false}>Connect WHOOP</button>}
      <div className="manual-recovery"><span className="eyebrow">MANUAL RECOVERY</span>{data.recoverySnapshots?.find(item => item.userReported) ? <small>User-reported recovery is available to Coach.</small> : <small>No manual recovery logged today.</small>}<button className="secondary" onClick={addRecovery}>Log recovery</button></div>
    </section>
    <section className="card dashboard"><span className="eyebrow">UPCOMING</span>{upcomingAfterToday(currentWeek, timezone).map(day => { const state = data.sessionStatusOverrides?.[day.id]?.status ?? day.status; return <div className="plan-row" key={day.id}><b>{dayLabel(day, today.day)}</b><span>{day.name}<small>{state === "rest" ? "Recovery day" : state.replaceAll("_", " ")}</small></span><select aria-label={`Status for ${day.name}`} value={state} onChange={event => updateStatus(day.id, event.target.value as SessionStatus)}><option value="planned">Planned</option><option value="completed">Completed</option><option value="missed">Missed</option><option value="rescheduled">Moved</option><option value="recovery_rest">Recovery Rest</option><option value="rest">Planned Rest</option><option value="unplanned_activity">Unplanned Activity</option><option value="illness_injury">Illness / Injury</option><option value="other">Other</option></select></div>; })}</section>
    <section className="card dashboard activity-card"><span className="eyebrow">DAILY ACTIVITY</span><div className="activity-grid"><span><b>STEPS</b><strong>{data.dailyActivity?.at(-1)?.steps ?? "—"}</strong><small>/ 10,000 goal</small></span><span><b>ACTIVE CALORIES</b><strong>{data.dailyActivity?.at(-1)?.activeCalories ?? "—"}</strong><small>kcal</small></span><span><b>WHOOP DAY STRAIN</b><strong>{snapshot?.strain ?? "—"}</strong><small>{snapshot?.strain === undefined ? "Not available" : "from WHOOP"}</small></span></div></section><section className="card dashboard block-card"><span className="eyebrow">CURRENT BLOCK</span><strong>Strength + Fat Loss</strong><p>Week {currentBlock.weekNumber} of 3 · 0 / 18 sessions</p><button className="secondary">View Block</button></section>
  </>;
}
