"use client";
import { useMemo } from "react";
import { AppNav } from "@/components/app-nav";
import { BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { activeWeek } from "@/lib/active-programme";
import { loadData } from "@/lib/storage";
import { resolveWeekSchedule } from "@/lib/schedule-resolver";
import { exercisesForSession } from "@/lib/workout";

export function TrainingPreviewClient({ occurrenceId }: { occurrenceId?: string }) {
  const data = loadData();
  const occurrence = useMemo(() => resolveWeekSchedule(activeWeek(), data, data.timezone ?? "Europe/London").occurrences.find(item => item.occurrenceId === occurrenceId), [data, occurrenceId]);
  if (!occurrence) return <main className="app-shell module-page"><PageHeader eyebrow="TRAINING" title="Workout preview" /><EmptyState title="Workout not found">This scheduled workout is no longer available.</EmptyState><BackButton href="/training">Back to Training</BackButton><AppNav /></main>;
  const exercises = exercisesForSession(occurrence.session.exerciseIds, occurrence.session.exerciseOverrides);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(new Date(`${occurrence.scheduledDate}T12:00:00Z`));
  const status = occurrence.status ?? "planned";
  return <main className="app-shell module-page workout-preview"><PageHeader eyebrow="WORKOUT PREVIEW" title={occurrence.session.name} description={`${day} · ${occurrence.scheduledDate}`} /><Surface><span className="eyebrow">SCHEDULED SESSION</span><p className="muted">Preview only · {String(status).replaceAll("_", " ")}</p>{exercises.map((exercise, index) => <div className="plan-row" key={exercise.id}><b>{String(index + 1).padStart(2, "0")}</b><span>{exercise.name}<small>{exercise.target} · {exercise.sets} working sets</small></span></div>)}</Surface><BackButton href="/training">Back to Training</BackButton><AppNav /></main>;
}
