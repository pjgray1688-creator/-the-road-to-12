"use client";
import { useState } from "react";
import { activeWeek } from "@/lib/active-programme";
import { planMissedSessionSalvage, type SalvageProposal } from "@/lib/session-outcomes";
import { resolveToday } from "@/lib/schedule";
import { loadActiveWorkout, loadData, saveData } from "@/lib/storage";
import { defaultTrainingProfile } from "@/lib/training-profile";

export function MissedSessionAction() {
  const [data, setData] = useState(() => loadData());
  const [salvage, setSalvage] = useState<SalvageProposal | null>(null);
  const timezone = data.timezone ?? (typeof window === "undefined" ? "Europe/London" : Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London");
  const today = resolveToday(activeWeek(), timezone);
  if ((!data.generatedProgramme && !data.trainingProfile) || today.session.status === "rest" || loadActiveWorkout()) return null;
  const status = data.sessionStatusOverrides?.[today.session.id]?.status;
  const review = () => setSalvage(planMissedSessionSalvage(today.session, activeWeek().filter(item => item.day > today.day && item.status === "planned"), data.workouts, data.trainingProfile ?? defaultTrainingProfile) ?? null);
  const markMissed = () => {
    if (!window.confirm("Mark today’s session as missed? No workout or progression will be recorded.")) return;
    const reason = window.prompt("Optional reason: recovery, unwell, pain, work, travel, equipment, or other") ?? undefined;
    const next = { ...data, sessionStatusOverrides: { ...(data.sessionStatusOverrides ?? {}), [today.session.id]: { status: "missed" as const, note: reason } } };
    saveData(next); setData(next); setSalvage(planMissedSessionSalvage(today.session, activeWeek().filter(item => item.day > today.day && item.status === "planned"), data.workouts, data.trainingProfile ?? defaultTrainingProfile) ?? null);
  };
  const apply = () => {
    if (!salvage) return;
    const next = { ...data, salvageAdjustments: [...(data.salvageAdjustments ?? []), ...salvage.additions.map(addition => ({ ...addition, source: today.session.id }))] };
    saveData(next); setData(next); setSalvage(null);
  };
  return <>{status === "missed" ? <section className="card dashboard session-actions"><span className="eyebrow">TODAY&apos;S SESSION</span><p>Marked as missed. Your programme stays on track without inventing completed work.</p><button className="secondary" onClick={review}>Review missed work</button></section> : <section className="card dashboard session-actions"><span className="eyebrow">TODAY&apos;S SESSION</span><p>Can&apos;t train today? Record it without shifting the rest of your week.</p><button className="secondary" onClick={markMissed}>Mark session missed</button></section>}{salvage && <div className="modal" role="dialog" aria-modal="true" aria-label="Review missed work"><section><div className="sheet-heading"><div><span className="eyebrow">COACH REVIEW</span><h2>{salvage.title}</h2></div><button className="text-button" onClick={() => setSalvage(null)}>Close</button></div><p>{salvage.detail}</p><p className="muted">Current-week option only. Your programme template and completed history stay unchanged.</p>{salvage.additions.length ? <><button className="primary" onClick={apply}>Apply modest changes</button><button className="secondary" onClick={() => setSalvage(null)}>Leave as missed</button></> : <button className="secondary" onClick={() => setSalvage(null)}>Leave as missed</button>}</section></div>}</>;
}
