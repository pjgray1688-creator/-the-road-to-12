"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardFoundation } from "./dashboard-foundation";
import { PwaRegister } from "./pwa-register";
import { TrainingApp } from "./training-app";
import { loadData } from "@/lib/storage";
import { completedWorkoutsOnDate } from "@/lib/schedule";
import type { Workout } from "@/lib/types";

function completedToday(timezone: string): Workout | undefined {
  return completedWorkoutsOnDate(loadData().workouts, new Date(), timezone)[0];
}

export function HomeShell() {
  const [timezone] = useState(() => typeof window === "undefined" ? "Europe/London" : (Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"));
  const [completed, setCompleted] = useState<Workout | undefined>(() => completedToday(timezone));
  const refresh = useCallback(() => setCompleted(completedToday(timezone)), [timezone]);
  useEffect(() => { const frame = window.requestAnimationFrame(refresh); window.addEventListener("focus", refresh); return () => { window.cancelAnimationFrame(frame); window.removeEventListener("focus", refresh); }; }, [refresh]);
  const summary = useMemo(() => { if (!completed) return undefined; const working = completed.sets.filter(set => set.kind === "working"); return { sets: working.length, cardio: completed.cardio?.duration }; }, [completed]);
  if (!completed) return <TrainingApp />;
  return <main className="shell"><PwaRegister /><DashboardFoundation /><section className="card dashboard post-workout" aria-label="Post-workout"><span className="eyebrow">TODAY COMPLETE</span><h2>Nice work.</h2><p>{completed.name} is complete.</p><small>{summary?.sets ?? 0} working sets logged{summary?.cardio ? ` · ${summary.cardio} min cardio` : ""}.</small><p className="coach-note">Training is done for today. Easy mobility or a relaxed walk is plenty if you want to move.</p><div className="post-workout-actions"><button className="secondary" onClick={() => window.alert("Keep any extra activity easy and recovery-focused.")}>Ask Coach</button><button className="secondary" onClick={() => window.alert("Log a walk or mobility session from your activity tracker when available.")}>Recovery work</button></div></section></main>;
}
