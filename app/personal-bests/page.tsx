"use client";
import { useEffect, useState } from "react";
import { fetchServerWorkouts } from "@/lib/workout-sync";
import { personalBests } from "@/lib/training-history";
import type { Workout } from "@/lib/types";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export default function PersonalBestsPage() { const [workouts, setWorkouts] = useState<Workout[]>([]); useEffect(() => { void fetchServerWorkouts().then(setWorkouts).catch(() => undefined); }, []); const bests = personalBests(workouts); return <AppShell className="legal-page"><PageHeader title="Personal Bests" description="Your strongest completed working sets." /><Surface>{bests.map(best => <div className="navigation-row pb-row" key={best.exerciseId}><span><strong>{best.exerciseName}</strong><small>Best set · {best.weight} kg × {best.reps}</small><small>{dateLabel(best.date)}{best.estimated1RM ? ` · est. 1RM ${best.estimated1RM} kg` : ""}</small></span><b className="pb-badge">PB</b></div>)}{bests.length === 0 && <EmptyState title="No personal bests yet">Your major lift PBs will appear here as you complete them.</EmptyState>}</Surface><BackButton>Back</BackButton></AppShell>; }
