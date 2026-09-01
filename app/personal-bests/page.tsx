"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchServerWorkouts } from "@/lib/workout-sync";
import { personalBests } from "@/lib/training-history";
import type { Workout } from "@/lib/types";
export default function PersonalBestsPage() { const [workouts, setWorkouts] = useState<Workout[]>([]); useEffect(() => { void fetchServerWorkouts().then(setWorkouts).catch(() => undefined); }, []); return <main className="legal-page"><header><p className="eyebrow">THE ROAD TO 12%</p><h1>Personal Bests</h1></header><section className="card">{personalBests(workouts).map(best => <div className="settings-row" key={best.exerciseId}><span>{best.exerciseName}<small>{best.weight} kg × {best.reps}{best.estimated1RM ? ` · est. 1RM ${best.estimated1RM} kg` : ""} · ${best.date}</small></span></div>)}{workouts.length === 0 && <p>No personal bests yet.</p>}</section><p><Link href="/">Back to app</Link></p></main>; }
