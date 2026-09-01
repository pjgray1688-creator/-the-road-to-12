"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchServerWorkouts } from "@/lib/workout-sync";
import { completedWorkouts, workingSets } from "@/lib/training-history";
import type { Workout } from "@/lib/types";

const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export default function HistoryPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([]); const [selected, setSelected] = useState<Workout>();
  useEffect(() => { void fetchServerWorkouts().then(setWorkouts).catch(() => undefined); }, []);
  if (selected) {
    const groups = new Map<string, Workout["sets"]>(); selected.sets.filter(set => set.kind === "working").forEach(set => groups.set(set.exerciseId, [...(groups.get(set.exerciseId) ?? []), set]));
    return <main className="legal-page"><header><p className="eyebrow">THE ROAD TO 12%</p><h1>{selected.name}</h1><p>{dateLabel(selected.completedAt ?? selected.startedAt)}</p></header><section className="card">{[...groups].map(([id, sets]) => <div className="history-exercise" key={id}><h3>{sets[0].exerciseName}</h3>{sets.map((set, index) => <div className="history-set" key={set.id}><span>Set {index + 1}</span><b>{set.weight} kg × {set.reps}{set.rir === undefined ? "" : ` · ${set.rir} RIR`}</b></div>)}</div>)}{selected.sets.some(set => set.kind !== "working") && <details><summary>Preparation sets</summary>{selected.sets.filter(set => set.kind !== "working").map(set => <small key={set.id} className="history-prep">{set.exerciseName} · {set.weight} kg × {set.reps}</small>)}</details>}{selected.cardio && <p>Cardio · {selected.cardio.duration} min</p>}{selected.notes.filter(note => !/skipped exercise:\s*(not specified|null|undefined)/i.test(note)).map(note => <p key={note}>{note}</p>)}</section><p><button className="text-button" onClick={() => setSelected(undefined)}>← All workouts</button></p><p><Link href="/">Back to app</Link></p></main>;
  }
  const history = completedWorkouts(workouts);
  return <main className="legal-page"><header><p className="eyebrow">THE ROAD TO 12%</p><h1>Workout History</h1></header><section className="card">{history.map(workout => <button className="settings-row" key={workout.id} onClick={() => setSelected(workout)}><span><strong>{workout.name}</strong><small>{dateLabel(workout.completedAt ?? workout.startedAt)} · {workingSets(workout).length} working sets</small></span><b>›</b></button>)}{history.length === 0 && <p>No completed workouts yet.</p>}</section><p><Link href="/">Back to app</Link></p></main>;
}
