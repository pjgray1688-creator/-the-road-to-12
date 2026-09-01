"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchServerWorkouts } from "@/lib/workout-sync";
import { personalBests } from "@/lib/training-history";
import type { Workout } from "@/lib/types";
const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export default function PersonalBestsPage() { const [workouts, setWorkouts] = useState<Workout[]>([]); useEffect(() => { void fetchServerWorkouts().then(setWorkouts).catch(() => undefined); }, []); const bests = personalBests(workouts); return <main className="legal-page"><header><p className="eyebrow">THE ROAD TO 12%</p><h1>Personal Bests</h1><p>Your strongest completed working sets.</p></header><section className="card">{bests.map(best => <div className="settings-row pb-row" key={best.exerciseId}><span><strong>{best.exerciseName}</strong><small>Best set · {best.weight} kg × {best.reps}</small><small>{dateLabel(best.date)}{best.estimated1RM ? ` · est. 1RM ${best.estimated1RM} kg` : ""}</small></span><b className="pb-badge">PB</b></div>)}{bests.length === 0 && <p>No personal bests yet.</p>}</section><p><Link href="/">‹ Back</Link></p></main>; }
