"use client";
import { useState } from "react";
import type { Workout } from "@/lib/types";
export function formatWhoopExport(workout: Workout) { const lines = workout.sets.filter(s => s.kind === "working").map(s => `${s.exerciseName} — ${s.weight}kg × ${s.reps}`); if (workout.cardio) lines.push(`Incline Treadmill — ${workout.cardio.duration} min — ${workout.cardio.incline}% incline — ${workout.cardio.speed.toFixed(1)} km/h`); return lines.join("\n"); }
export function WhoopExport({ workout }: { workout: Workout }) { const value = formatWhoopExport(workout); const [copied, setCopied] = useState(false); return <section className="card export"><span className="eyebrow">WHOOP EXPORT</span><pre>{value}</pre><button className="primary" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}> {copied ? "Copied" : "Copy export"}</button></section>; }
