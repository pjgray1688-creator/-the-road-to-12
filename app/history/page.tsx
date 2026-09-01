"use client";
import { useEffect, useState } from "react";
import { fetchServerWorkouts } from "@/lib/workout-sync";
import { completedWorkouts, formatLogicalHistorySet, historyExerciseGroups, workingSets } from "@/lib/training-history";
import type { Workout } from "@/lib/types";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";

const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export default function HistoryPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([]); const [selected, setSelected] = useState<Workout>();
  useEffect(() => { void fetchServerWorkouts().then(setWorkouts).catch(() => undefined); }, []);
  if (selected) {
    const groups = historyExerciseGroups(selected);
    return <AppShell className="legal-page"><PageHeader title={selected.name} description={dateLabel(selected.completedAt ?? selected.startedAt)} />
      <Surface>{groups.map(group => <div className="history-exercise" key={group.exerciseId}><h3>{group.exerciseName}</h3>{Array.from({ length: group.unilateral ? Math.ceil(group.sets.length / 2) : group.sets.length }, (_, index) => { const entries = group.unilateral ? group.sets.slice(index * 2, index * 2 + 2) : [group.sets[index]]; return <div className="history-set" key={entries[0].id}><span>Set {index + 1}</span><b>{formatLogicalHistorySet(entries)}</b></div>; })}</div>)}{selected.sets.some(set => set.kind !== "working") && <details><summary>Preparation sets</summary>{selected.sets.filter(set => set.kind !== "working").map(set => <small key={set.id} className="history-prep">{set.exerciseName} · {set.weight} kg × {set.reps}</small>)}</details>}{selected.cardio && <p>Cardio · {selected.cardio.duration} min</p>}{selected.notes.filter(note => !/skipped(?: remaining sets| exercise)?\s*:\s*(?:not specified|null|undefined)?\s*$/i.test(note)).map(note => <p key={note}>{note}</p>)}</Surface><BackButton href="/history">Back</BackButton><AppNav /></AppShell>;
  }
  const history = completedWorkouts(workouts);
  return <AppShell className="legal-page"><PageHeader title="Workout History" description="Completed sessions and working-set performance." /><Surface>{history.map(workout => <button className="navigation-row" key={workout.id} onClick={() => setSelected(workout)}><span><strong>{workout.name}</strong><small>{dateLabel(workout.completedAt ?? workout.startedAt)} · {workingSets(workout).length} working sets</small></span><b aria-hidden="true">›</b></button>)}{history.length === 0 && <EmptyState title="No completed workouts yet">Finish a session to start building your training history.</EmptyState>}</Surface><BackButton>Back</BackButton><AppNav /></AppShell>;
}
