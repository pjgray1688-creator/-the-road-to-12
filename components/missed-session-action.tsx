"use client";
import { useState } from "react";
import { activeWeek } from "@/lib/active-programme";
import { planMissedSessionSalvage, type SalvageProposal } from "@/lib/session-outcomes";
import { occurrenceDateForDay, occurrenceKey, resolveToday } from "@/lib/schedule";
import { resolveWeekSchedule } from "@/lib/schedule-resolver";
import { loadActiveWorkout, loadData, saveData } from "@/lib/storage";
import { defaultTrainingProfile } from "@/lib/training-profile";
import { allExercises } from "@/lib/workout";

const exerciseName = (id: string) => allExercises().find(item => item.id === id)?.name ?? "compatible accessory work";

export function MissedSessionAction({ occurrence }: { occurrence?: ReturnType<typeof resolveToday> } = {}) {
  const [data, setData] = useState(() => loadData());
  const [salvage, setSalvage] = useState<SalvageProposal | null>(null); const [confirmOpen, setConfirmOpen] = useState(false); const [reasonOpen, setReasonOpen] = useState(false);
  const timezone = data.timezone ?? (typeof window === "undefined" ? "Europe/London" : Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London");
  const today = occurrence ?? resolveToday(activeWeek(), timezone);
  if ((!data.generatedProgramme && !data.trainingProfile) || today.session.status === "rest" || loadActiveWorkout()) return null;
  const overrides = data.sessionStatusOverrides ?? {};
  const canonicalWeek = resolveWeekSchedule(activeWeek(), data, timezone, new Date(`${today.date}T12:00:00Z`));
  const priorMiss = canonicalWeek.occurrences.filter(item => item.scheduledDate <= today.date).map(item => ({ session: item.session, date: item.scheduledDate })).reverse().find(item => overrides[occurrenceKey(item.session.id, item.date)]?.status === "missed" || (overrides[item.session.id]?.status === "missed" && item.session.day < today.day));
  const reviewSession = priorMiss?.session ?? today.session;
  const reviewDate = priorMiss?.date ?? today.date;
  const status = overrides[occurrenceKey(today.session.id, today.date)]?.status ?? (today.session.id === reviewSession.id ? overrides[today.session.id]?.status : undefined) ?? (priorMiss ? "missed" : undefined);
  const plan = (reasonOverride?: string) => {
    const recovery = data.recoverySnapshots?.filter(item => item.source === "whoop" && item.date === today.date).sort((a, b) => `${a.date}${a.providerTimestamp ?? ""}`.localeCompare(`${b.date}${b.providerTimestamp ?? ""}`)).at(-1);
    const reason = reasonOverride ?? overrides[occurrenceKey(reviewSession.id, reviewDate)]?.note ?? overrides[reviewSession.id]?.note;
    const canonical = resolveWeekSchedule(activeWeek(), data, timezone, new Date(`${reviewDate}T12:00:00Z`));
    const remaining = canonical.occurrences.filter(item => item.scheduledDate > reviewDate && item.session.status === "planned").map(item => ({ ...item.session, scheduledDate: item.scheduledDate, occurrenceId: item.occurrenceId }));
    return planMissedSessionSalvage(reviewSession, remaining, data.workouts, data.trainingProfile ?? defaultTrainingProfile, recovery, reason);
  };
  const review = () => setSalvage(plan());
  const saveMissed = async (reason?: string) => {
    const next = { ...data, sessionStatusOverrides: { ...(data.sessionStatusOverrides ?? {}), [occurrenceKey(today.session.id, today.date)]: { status: "missed" as const, note: reason } } };
    try { const response = await fetch("/api/training-state", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionStatusOverrides: next.sessionStatusOverrides, salvageAdjustments: next.salvageAdjustments ?? [] }) }); if (!response.ok) throw new Error(); saveData(next); setData(next); setReasonOpen(false); setConfirmOpen(false); setSalvage(plan(reason)); } catch { setReasonOpen(false); setConfirmOpen(false); }
  };
  const apply = () => {
    if (!salvage) return;
    const existing = data.salvageAdjustments ?? [];
    const additions = salvage.additions.map(addition => ({ ...addition, source: reviewSession.id, scheduledDate: addition.scheduledDate ?? occurrenceDateForDay(new Date(`${reviewDate}T12:00:00Z`), timezone, activeWeek().find(item => item.id === addition.sessionId)?.day ?? today.day) })).filter(addition => !existing.some(item => item.source === addition.source && item.sessionId === addition.sessionId && item.scheduledDate === addition.scheduledDate && item.exerciseId === addition.exerciseId));
    const next = { ...data, salvageAdjustments: [...existing, ...additions] };
    void fetch("/api/training-state", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionStatusOverrides: next.sessionStatusOverrides ?? data.sessionStatusOverrides ?? {}, salvageAdjustments: next.salvageAdjustments }) }).then(response => { if (!response.ok) throw new Error(); saveData(next); setData(next); setSalvage(null); }).catch(() => undefined);
  };
  return <>{status === "missed" ? <section className="card dashboard session-actions"><span className="eyebrow">TODAY&apos;S SESSION</span><p>Marked as missed. Your programme stays on track without inventing completed work.</p><button className="secondary" onClick={review}>Review missed work</button></section> : <section className="session-exception"><span>Can&apos;t train today?</span><button className="text-button" onClick={() => setConfirmOpen(true)}>Mark this session as missed</button></section>}{confirmOpen && <div className="modal programme-action-modal" role="dialog" aria-modal="true" aria-label="Mark session missed"><section className="programme-action-sheet"><div className="sheet-heading"><div><span className="eyebrow">TODAY&apos;S SESSION</span><h2>Mark session missed?</h2></div><button className="text-button" onClick={() => setConfirmOpen(false)}>Cancel</button></div><p>This records the planned session as missed without creating completed sets or changing the rest of your programme.</p><button className="secondary" onClick={() => setReasonOpen(true)}>Continue</button></section></div>}{reasonOpen && <div className="modal programme-action-modal" role="dialog" aria-modal="true" aria-label="Missed session reason"><section className="programme-action-sheet"><div className="sheet-heading"><div><span className="eyebrow">OPTIONAL</span><h2>Why did you miss it?</h2></div><button className="text-button" onClick={() => setReasonOpen(false)}>Skip</button></div><div className="status-options">{["Recovery / fatigue", "Unwell", "Pain / injury", "Work / time", "Travel", "Equipment / access", "Other", "Prefer not to say"].map(reason => <button className="secondary" key={reason} onClick={() => saveMissed(reason)}>{reason}</button>)}</div><button className="text-button" onClick={() => saveMissed()}>Skip reason</button></section></div>}{salvage && <div className="modal programme-action-modal" role="dialog" aria-modal="true" aria-label="Review missed work"><section className="programme-action-sheet"><div className="sheet-heading"><div><span className="eyebrow">COACH REVIEW · THIS WEEK</span><h2>{salvage.title}</h2></div><button className="text-button" onClick={() => setSalvage(null)}>Close</button></div><p>{salvage.detail}</p><p className="muted">Current-week option only. Your programme template and completed history stay unchanged.</p>{salvage.additions.length ? <><span className="eyebrow">PROPOSED CHANGE</span>{salvage.additions.map(addition => <p key={`${activeWeek().find(item => item.id === addition.sessionId)?.name ?? "the next suitable session"}-${exerciseName(addition.exerciseId)}`}>Add {addition.sets} set{addition.sets === 1 ? "" : "s"} of {exerciseName(addition.exerciseId)} to {activeWeek().find(item => item.id === addition.sessionId)?.name ?? "the next suitable session"}.</p>)}<span className="eyebrow">NOT RECOVERED</span><p>{salvage.notRecovered?.length ? salvage.notRecovered.join(", ") : "Heavy work from the missed session remains missed."}.</p><button className="primary" onClick={apply}>Apply changes</button><button className="secondary" onClick={() => setSalvage(null)}>Leave as missed</button></> : <><p className="muted">No current-week change is needed.</p><button className="secondary" onClick={() => setSalvage(null)}>Leave as missed</button></>}</section></div>}</>;
}
