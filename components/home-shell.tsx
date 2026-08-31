"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardFoundation } from "./dashboard-foundation";
import { PwaRegister } from "./pwa-register";
import { TrainingApp } from "./training-app";
import { currentWeek } from "@/lib/domain";
import { resolveToday, selectCompletedWorkout } from "@/lib/schedule";
import { fetchServerWorkouts, importLocalWorkouts, cacheServerWorkouts } from "@/lib/workout-sync";
import type { Workout } from "@/lib/types";

function completedToday(workouts: Workout[], timezone: string): Workout | undefined {
  return selectCompletedWorkout(workouts, new Date(), timezone, resolveToday(currentWeek, timezone).session?.id);
}

export function HomeShell() {
  const [timezone] = useState(() => typeof window === "undefined" ? "Europe/London" : (Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"));
  const [completed, setCompleted] = useState<Workout | undefined>();
  const [active, setActive] = useState<Workout | undefined>();
  const [resolved, setResolved] = useState(false);
  const [resumeRequested, setResumeRequested] = useState(false);
  const [serverWorkouts, setServerWorkouts] = useState<Workout[]>([]);
  const [serverResolved, setServerResolved] = useState(false);
  const hydrateServer = useCallback(async () => {
    try {
      let workouts = await fetchServerWorkouts();
      if (!serverResolved) {
        await importLocalWorkouts().catch(() => undefined);
        workouts = await fetchServerWorkouts();
      }
      cacheServerWorkouts(workouts); setServerWorkouts(workouts); setServerResolved(true);
      const plan = resolveToday(currentWeek, timezone); setCompleted(completedToday(workouts, timezone));
      setActive(workouts.find(item => item.status === "active" && item.plannedSessionId === plan.session?.id && item.scheduledDate === new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date())));
      setResolved(true);
    } catch { setServerResolved(false); }
  }, [serverResolved, timezone]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void hydrateServer()); const onFocus = () => void hydrateServer(); window.addEventListener("focus", onFocus); return () => { window.cancelAnimationFrame(frame); window.removeEventListener("focus", onFocus); }; }, [hydrateServer]);
  const summary = useMemo(() => { if (!completed) return undefined; const working = completed.sets.filter(set => set.kind === "working"); return { sets: working.length, cardio: completed.cardio?.duration }; }, [completed]);
  if (!resolved || !serverResolved) return <main className="shell home-screen" aria-busy="true"><PwaRegister /><section className="card dashboard"><span className="eyebrow">THE ROAD TO 12%</span><p>Loading today&apos;s plan…</p></section></main>;
  if (resumeRequested && active) return <TrainingApp resumeWorkout={active} workoutHistory={serverWorkouts} />;
  if (!completed && active) return <main className="shell home-screen"><PwaRegister /><DashboardFoundation workoutHistory={serverWorkouts} /><section className="card dashboard post-workout"><span className="eyebrow">WORKOUT IN PROGRESS</span><h2>{active.name}</h2><p>Your logged sets are saved. Resume when you&apos;re ready.</p><button className="primary big" onClick={() => setResumeRequested(true)}>Resume workout →</button></section></main>;
  if (!completed) return <TrainingApp workoutHistory={serverWorkouts} />;
  return <main className="shell home-screen"><PwaRegister /><DashboardFoundation workoutHistory={serverWorkouts} /><section className="card dashboard post-workout" aria-label="Post-workout"><span className="eyebrow">TODAY COMPLETE</span><h2>Nice work.</h2><p>{completed.name} is complete.</p><small>{summary?.sets ?? 0} working sets logged{summary?.cardio ? ` · ${summary.cardio} min cardio` : ""}.</small><p className="coach-note">Training is done for today. Easy mobility or a relaxed walk is plenty if you want to move.</p><div className="post-workout-actions"><button className="secondary" onClick={() => window.alert("Keep any extra activity easy and recovery-focused.")}>Ask Coach</button><button className="secondary" onClick={() => window.alert("Log a walk or mobility session from your activity tracker when available.")}>Recovery work</button></div></section></main>;
}
