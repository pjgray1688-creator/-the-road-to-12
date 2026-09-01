"use client";
import { AppNav } from "@/components/app-nav";
import { BackButton, EmptyState, NavigationRow, PageHeader, ProgressBar, Surface } from "@/components/ui";
import { currentBlock } from "@/lib/domain";
import { activeWeek } from "@/lib/active-programme";
import { loadGeneratedProgramme } from "@/lib/storage";
import { programmeSnapshot } from "@/lib/programme-progress";
import { fetchServerWorkouts } from "@/lib/workout-sync";
import type { Workout } from "@/lib/types";
import { useEffect, useState } from "react";

export default function TrainingPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  useEffect(() => { void fetchServerWorkouts().then(setWorkouts).catch(() => undefined); }, []);
  const generated = loadGeneratedProgramme(); const week = activeWeek(); const block = generated?.block ?? currentBlock; const programmeName = generated?.name ?? "Strength + Fat Loss"; const snapshot = programmeSnapshot(programmeName, block, week, workouts, Boolean(generated));
  return <main className="shell module-page"><PageHeader eyebrow="TRAINING" title="Training" description="Your current programme, sessions and performance." /><Surface><span className="eyebrow">ACTIVE PROGRAMME</span><h2 className="module-card-title">{snapshot.name}</h2><p>{snapshot.goal.replaceAll("_", " ")} · {snapshot.daysPerWeek} training days</p><p>Week {snapshot.currentWeek} of {snapshot.totalWeeks} · {snapshot.completedSessions} of {snapshot.totalSessions} workouts</p><ProgressBar value={snapshot.progressPercent} label="Programme progress" /></Surface><Surface><span className="eyebrow">NEXT WORKOUT</span>{snapshot.nextSession ? <NavigationRow href="/" label={snapshot.nextSession.name} /> : <EmptyState title="Block complete">Review your progress before starting another block.</EmptyState>}</Surface><Surface><span className="eyebrow">BLOCK WEEKS</span>{Array.from({ length: snapshot.totalWeeks }, (_, index) => <div className="plan-row" key={index}><b>Week {index + 1}</b><span>{index + 1 < snapshot.currentWeek ? "Completed" : index + 1 === snapshot.currentWeek ? "Current" : "Upcoming"}<small>{snapshot.sessionsPerWeek} training sessions</small></span></div>)}</Surface><Surface><NavigationRow href="/history" label="Workout History" /><NavigationRow href="/personal-bests" label="Personal Bests" /><NavigationRow href="/onboarding" label="Build a new programme" /></Surface>{workouts.length === 0 && <EmptyState title="Your training history will appear here">Complete a session to build your record.</EmptyState>}<BackButton>Back</BackButton><AppNav /></main>;
}
