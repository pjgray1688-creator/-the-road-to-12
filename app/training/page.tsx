"use client";
import { AppNav } from "@/components/app-nav";
import { BackButton, EmptyState, NavigationRow, PageHeader, ProgressBar, Surface } from "@/components/ui";
import { currentBlock } from "@/lib/domain";
import { fetchServerWorkouts } from "@/lib/workout-sync";
import { uniqueCompletedSessionCount } from "@/lib/schedule";
import type { Workout } from "@/lib/types";
import { useEffect, useState } from "react";

export default function TrainingPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  useEffect(() => { void fetchServerWorkouts().then(setWorkouts).catch(() => undefined); }, []);
  const completed = uniqueCompletedSessionCount(workouts, currentBlock.startDate, currentBlock.endDate, "Europe/London");
  return <main className="shell module-page"><PageHeader eyebrow="TRAINING" title="Training" description="Your current block, sessions and performance." /><Surface><span className="eyebrow">CURRENT BLOCK</span><h2 className="module-card-title">Strength + Fat Loss</h2><p>Week {currentBlock.weekNumber} of 3 · {completed} of 18 sessions</p><ProgressBar value={completed / 18 * 100} label="Training block progress" /></Surface><Surface><NavigationRow href="/history" label="Workout History" /><NavigationRow href="/personal-bests" label="Personal Bests" /><NavigationRow href="/onboarding" label="Build a new programme" /></Surface>{workouts.length === 0 && <EmptyState title="Your training history will appear here">Complete a session to build your record.</EmptyState>}<BackButton>Back</BackButton><AppNav /></main>;
}
