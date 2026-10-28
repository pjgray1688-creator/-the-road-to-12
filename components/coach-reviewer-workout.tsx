"use client";

import { useState } from "react";
import type { ReviewerClient } from "@/lib/coach-reviewer-fixtures";
import styles from "./coach-reviewer-demo.module.css";

type LoggedSet = { load: string; reps: string; rir: string; leftLoad: string; rightLoad: string };
type LoggedExercise = { name: string; substitution: string; notes: string; sets: LoggedSet[] };

const initialExercises = (): LoggedExercise[] => [
  { name: "Trap-Bar Deadlift", substitution: "", notes: "", sets: Array.from({ length: 3 }, () => ({ load: "", reps: "", rir: "", leftLoad: "", rightLoad: "" })) },
  { name: "Bulgarian Split Squat", substitution: "", notes: "", sets: Array.from({ length: 3 }, () => ({ load: "", reps: "", rir: "", leftLoad: "", rightLoad: "" })) },
];

export function CoachReviewerWorkout({ client, title = "Coach-led workout", onClose }: { client: ReviewerClient; title?: string; onClose: () => void }) {
  const [exercises, setExercises] = useState(initialExercises);
  const [sessionNotes, setSessionNotes] = useState("");
  const [message, setMessage] = useState("");
  const updateSet = (exerciseIndex: number, setIndex: number, key: keyof LoggedSet, value: string) => setExercises(current => current.map((exercise, index) => index !== exerciseIndex ? exercise : { ...exercise, sets: exercise.sets.map((set, currentSet) => currentSet === setIndex ? { ...set, [key]: value } : set) }));
  const updateExercise = (exerciseIndex: number, key: "substitution" | "notes", value: string) => setExercises(current => current.map((exercise, index) => index === exerciseIndex ? { ...exercise, [key]: value } : exercise));
  return <section className={styles.workout} aria-labelledby="reviewer-workout-title">
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>SESSION LOG</span><h2 id="reviewer-workout-title">{title}</h2><p>{client.name} · {client.programmeName}</p></div><button type="button" className={styles.secondaryAction} onClick={onClose}>Close</button></div>
    {exercises.map((exercise, exerciseIndex) => <fieldset className={styles.exerciseLog} key={exercise.name}><legend>{exercise.name}</legend>{exercise.sets.map((set, setIndex) => <div className={styles.setGrid} key={setIndex}><strong>Set {setIndex + 1}</strong><label>Load<input inputMode="decimal" value={set.load} onChange={event => updateSet(exerciseIndex, setIndex, "load", event.target.value)} placeholder="kg" /></label><label>Reps<input inputMode="numeric" value={set.reps} onChange={event => updateSet(exerciseIndex, setIndex, "reps", event.target.value)} /></label><label>RIR<input inputMode="numeric" value={set.rir} onChange={event => updateSet(exerciseIndex, setIndex, "rir", event.target.value)} /></label>{exercise.name.includes("Split Squat") ? <><label>Left load<input inputMode="decimal" value={set.leftLoad} onChange={event => updateSet(exerciseIndex, setIndex, "leftLoad", event.target.value)} placeholder="kg" /></label><label>Right load<input inputMode="decimal" value={set.rightLoad} onChange={event => updateSet(exerciseIndex, setIndex, "rightLoad", event.target.value)} placeholder="kg" /></label></> : null}</div>)}<label>Substitution<input value={exercise.substitution} onChange={event => updateExercise(exerciseIndex, "substitution", event.target.value)} placeholder="Optional replacement exercise" /></label><label>Exercise notes<textarea value={exercise.notes} onChange={event => updateExercise(exerciseIndex, "notes", event.target.value)} /></label></fieldset>)}
    <label className={styles.blockLabel}>Session notes<textarea value={sessionNotes} onChange={event => setSessionNotes(event.target.value)} placeholder="Coaching observations and adaptations" /></label>
    <div className={styles.actions}><button type="button" className={styles.secondaryAction} onClick={() => setExercises(current => [...current, { name: "Added exercise", substitution: "", notes: "", sets: [{ load: "", reps: "", rir: "", leftLoad: "", rightLoad: "" }] }])}>+ Add exercise</button><button type="button" className={styles.primaryAction} onClick={() => setMessage(title + " saved to " + client.name + "'s review-session history. No production record was changed.")}>Complete session</button></div>
    {message ? <p className={styles.sessionMessage} role="status">{message}</p> : null}
  </section>;
}
