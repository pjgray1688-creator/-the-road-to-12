"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardFoundation } from "./dashboard-foundation";
import { TrainingApp } from "./training-app";
import { currentWeek } from "@/lib/domain";
import { resolveToday, selectCompletedWorkout } from "@/lib/schedule";
import { fetchServerWorkouts, importLocalWorkouts, cacheServerWorkouts } from "@/lib/workout-sync";
import { mondayExercises } from "@/lib/workout";
import type { Workout } from "@/lib/types";
import { AppNav } from "./app-nav";

function completedToday(workouts: Workout[], timezone: string): Workout | undefined {
  return selectCompletedWorkout(workouts, new Date(), timezone, resolveToday(currentWeek, timezone).session?.id);
}

function CoachSheet({ workout, onClose }: { workout: Workout; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!question.trim() || sending) return;
    setSending(true); setReply("");
    const exercise = mondayExercises.find(item => workout.sets.some(set => set.exerciseId === item.id)) ?? mondayExercises[0];
    try {
      const response = await fetch("/api/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exercise, loggedSets: workout.sets.filter(set => set.exerciseId === exercise.id), previousSets: [], feedback: question, context: { completedWorkout: workout.name, completedAt: workout.completedAt, workingSets: workout.sets.filter(set => set.kind === "working").length, cardio: workout.cardio, block: "Strength + Fat Loss", question } }) });
      const result = await response.json(); setReply(response.ok ? (result.detail ?? "Keep any extra activity easy and recovery-focused.") : "Coach is unavailable right now. Keep any extra activity easy and recovery-focused.");
    } catch { setReply("Coach is unavailable right now. Keep any extra activity easy and recovery-focused."); }
    setSending(false); setQuestion("");
  };
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Ask Coach"><section><div className="sheet-heading"><div><span className="eyebrow">COACH</span><h2>Ask Coach</h2></div><button className="text-button" onClick={onClose}>Close</button></div><p>Today&apos;s {workout.name} is complete. What would you like to do next?</p><div className="conversation" aria-live="polite">{reply ? <div className="coach-callout"><strong>{reply}</strong></div> : <small>Coach has today&apos;s logged sets and cardio context.</small>}</div><label className="sheet-input">Your question<input autoFocus value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void send(); }} placeholder="Should I walk or recover?" /></label><button className="primary" disabled={!question.trim() || sending} onClick={() => void send()}>{sending ? "Thinking…" : "Send to Coach"}</button></section></div>;
}

function RecoverySheet({ onClose }: { onClose: () => void }) {
  const [activity, setActivity] = useState("Walk");
  const [duration, setDuration] = useState("");
  const [effort, setEffort] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  if (saved) return <div className="modal" role="dialog" aria-modal="true" aria-label="Recovery activity logged"><section><div className="sheet-heading"><div><span className="eyebrow">RECOVERY ACTIVITY</span><h2>Noted</h2></div><button className="text-button" onClick={onClose}>Close</button></div><p>{activity}{duration ? ` · ${duration} min` : ""} is ready to be added to your activity history when recovery-activity persistence is enabled.</p><button className="primary" onClick={onClose}>Done</button></section></div>;
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Log recovery activity"><section><div className="sheet-heading"><div><span className="eyebrow">RECOVERY ACTIVITY</span><h2>Log recovery work</h2></div><button className="text-button" onClick={onClose}>Close</button></div><p>Keep it easy and supportive of today&apos;s completed training.</p><label className="sheet-input">Activity<select value={activity} onChange={event => setActivity(event.target.value)}>{["Walk", "Mobility", "Stretching", "Yoga", "Easy cycling", "Other"].map(item => <option key={item}>{item}</option>)}</select></label><label className="sheet-input">Duration<input inputMode="numeric" value={duration} onChange={event => setDuration(event.target.value)} placeholder="Minutes" /></label><label className="sheet-input">Perceived effort <input inputMode="numeric" value={effort} onChange={event => setEffort(event.target.value)} placeholder="Optional 1–5" /></label><label className="sheet-input">Notes <input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional" /></label><button className="primary" onClick={() => setSaved(true)}>Log activity</button></section></div>;
}

export function HomeShell() {
  const [timezone] = useState(() => typeof window === "undefined" ? "Europe/London" : (Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"));
  const [completed, setCompleted] = useState<Workout | undefined>();
  const [active, setActive] = useState<Workout | undefined>();
  const [resolved, setResolved] = useState(false);
  const [resumeRequested, setResumeRequested] = useState(false);
  const [serverWorkouts, setServerWorkouts] = useState<Workout[]>([]);
  const [serverResolved, setServerResolved] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
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
  useEffect(() => { const frame = window.requestAnimationFrame(() => void hydrateServer()); const onFocus = () => void hydrateServer(); const onWorkoutsUpdated = () => void hydrateServer(); window.addEventListener("focus", onFocus); window.addEventListener("workouts-updated", onWorkoutsUpdated); return () => { window.cancelAnimationFrame(frame); window.removeEventListener("focus", onFocus); window.removeEventListener("workouts-updated", onWorkoutsUpdated); }; }, [hydrateServer]);
  const summary = useMemo(() => { if (!completed) return undefined; const working = completed.sets.filter(set => set.kind === "working"); return { sets: working.length, cardio: completed.cardio?.duration }; }, [completed]);
  if (!resolved || !serverResolved) return <main className="shell home-screen" aria-busy="true"><section className="card dashboard"><span className="eyebrow">THE ROAD TO 12%</span><p>Loading today&apos;s plan…</p></section></main>;
  if (resumeRequested && active) return <TrainingApp resumeWorkout={active} workoutHistory={serverWorkouts} onMinimize={() => setResumeRequested(false)} onDiscard={() => { setResumeRequested(false); setActive(undefined); void hydrateServer(); }} />;
  if (!completed && active) return <main className="shell home-screen"><DashboardFoundation workoutHistory={serverWorkouts} /><section className="card dashboard post-workout active-workout-card"><span className="eyebrow">WORKOUT IN PROGRESS</span><h2>{active.name}</h2><p>Your logged sets are saved. Resume when you&apos;re ready.</p><button className="primary big" onClick={() => setResumeRequested(true)}>Resume workout →</button></section><AppNav /></main>;
  if (!completed) return <TrainingApp workoutHistory={serverWorkouts} onMinimize={(current) => { if (current) setActive(current); setResumeRequested(false); }} />;
  return <main className="shell home-screen"><DashboardFoundation workoutHistory={serverWorkouts} /><section className="card dashboard post-workout" aria-label="Post-workout"><span className="eyebrow">TODAY COMPLETE</span><h2>Nice work.</h2><p>{completed.name} is complete.</p><small>{summary?.sets ?? 0} working sets logged{summary?.cardio ? ` · ${summary.cardio} min cardio` : ""}.</small><p className="coach-note">Training is done for today. Easy mobility or a relaxed walk is plenty if you want to move.</p><div className="post-workout-actions"><button className="secondary" onClick={() => setCoachOpen(true)}>Ask Coach</button><button className="secondary" onClick={() => setRecoveryOpen(true)}>Recovery work</button></div></section>{coachOpen && <CoachSheet workout={completed} onClose={() => setCoachOpen(false)} />}{recoveryOpen && <RecoverySheet onClose={() => setRecoveryOpen(false)} />}<AppNav /></main>;
}
