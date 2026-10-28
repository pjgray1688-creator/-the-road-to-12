"use client";

import { useState } from "react";
import type { ReviewerClient } from "@/lib/coach-reviewer-fixtures";
import { CoachReviewerWorkout } from "./coach-reviewer-workout";
import styles from "./coach-reviewer-demo.module.css";

type ClientSection = "overview" | "history" | "progress" | "programme" | "nutrition" | "sessions";
const sections: Array<{ key: ClientSection; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "Workout History" },
  { key: "progress", label: "Progress / Measurements" },
  { key: "programme", label: "Programme" },
  { key: "nutrition", label: "Nutrition" },
  { key: "sessions", label: "Sessions / Diary" },
];

export function CoachReviewerClientWorkspace({ client, onBack }: { client: ReviewerClient; onBack: () => void }) {
  const [section, setSection] = useState<ClientSection>("overview");
  const [workout, setWorkout] = useState<string | null>(null);
  const latestWorkout = client.workouts[0];
  const nextSession = client.sessions.find(session => session.status === "Upcoming");
  if (workout) return <CoachReviewerWorkout client={client} title={workout} onClose={() => setWorkout(null)}/>;
  return <section className={styles.clientWorkspace}>
    <button type="button" className={styles.backAction} onClick={onBack}>← All clients</button>
    <header className={styles.clientHero}><div><span className={styles.eyebrow}>CLIENT WORKSPACE</span><h1>{client.name}</h1><p>{client.relationship} · Primary coach</p></div><button type="button" className={styles.primaryAction} onClick={() => setWorkout("Coach-led workout")}>Start Workout</button></header>
    <nav className={styles.clientTabs} aria-label="Client workspace">{sections.map(item => <button key={item.key} type="button" aria-current={section === item.key ? "page" : undefined} onClick={() => setSection(item.key)}>{item.label}</button>)}</nav>
    {section === "overview" ? <div className={styles.overviewGrid}>
      <article className={styles.card}><span className={styles.eyebrow}>CURRENT WEIGHT</span><h2>{client.weight}</h2><p>{client.measurements[0]?.note}</p></article>
      <article className={styles.card}><span className={styles.eyebrow}>PROGRAMME</span><h2>{client.programmeName}</h2><button type="button" className={styles.secondaryAction} onClick={() => setSection("programme")}>Open programme</button></article>
      <article className={styles.card}><span className={styles.eyebrow}>RECENT WORKOUT</span><h2>{latestWorkout?.name ?? "No workout"}</h2><p>{latestWorkout?.date ?? "No completed training yet"}</p><button type="button" className={styles.secondaryAction} onClick={() => setSection("history")}>View history</button></article>
      <article className={styles.card}><span className={styles.eyebrow}>NEXT COACHING SESSION</span><h2>{nextSession?.type ?? "No session booked"}</h2><p>{nextSession?.when}</p><button type="button" className={styles.secondaryAction} onClick={() => setSection("sessions")}>Open diary</button></article>
      <article className={styles.card}><span className={styles.eyebrow}>NUTRITION</span><h2>{client.nutritionStatus}</h2><button type="button" className={styles.secondaryAction} onClick={() => setSection("nutrition")}>View plan</button></article>
      <article className={styles.card}><span className={styles.eyebrow}>PROGRESS</span><h2>{client.measurements[0]?.waist}</h2><p>{client.progressUpdate}</p><button type="button" className={styles.secondaryAction} onClick={() => setSection("progress")}>Measurements</button></article>
    </div> : null}
    {section === "history" ? <section className={styles.card}><span className={styles.eyebrow}>WORKOUT HISTORY</span><h2>Completed training</h2>{client.workouts.map(item => <article className={styles.historyCard} key={item.id}><div><strong>{item.name}</strong><small>{item.date}</small></div>{item.exercises.map(exercise => <div className={styles.historyExercise} key={exercise.name}><strong>{exercise.name}</strong>{exercise.sets.map((set, index) => <small key={index}>Set {index + 1}: {set.load} · {set.reps} reps · {set.rir} RIR{set.side ? ` · ${set.side}` : ""}</small>)}{exercise.substitution ? <small>Substitution: {exercise.substitution}</small> : null}{exercise.notes ? <small>Notes: {exercise.notes}</small> : null}</div>)}</article>)}</section> : null}
    {section === "progress" ? <section className={styles.card}><span className={styles.eyebrow}>PROGRESS / MEASUREMENTS</span><h2>Current and historical progress</h2><p>{client.progressUpdate}</p><div className={styles.measurements}>{client.measurements.map(item => <div key={item.date}><strong>{item.date}</strong><span>{item.weight}</span><span>Waist {item.waist}</span><small>{item.note}</small></div>)}</div><h3>Personal bests</h3><ul className={styles.list}>{client.personalBests.map(item => <li key={item}>{item}</li>)}</ul></section> : null}
    {section === "programme" ? <section className={styles.card}><span className={styles.eyebrow}>PROGRAMME</span><h2>{client.programmeName}</h2><p>Current active prescription with exercise, set, rep, load, RIR and rest targets.</p><div className={styles.row}><span><strong>Lower Strength</strong><small>3 exercises · straight sets and superset blocks</small></span><em className={styles.status}>Active</em></div><div className={styles.actions}><button type="button" className={styles.primaryAction} onClick={() => setWorkout("Lower Strength")}>Start Workout</button></div></section> : null}
    {section === "nutrition" ? <section className={styles.card}><span className={styles.eyebrow}>NUTRITION</span><h2>{client.nutritionStatus}</h2><div className={styles.targetGrid}><div><strong>2,600</strong><small>kcal</small></div><div><strong>190 g</strong><small>protein</small></div><div><strong>290 g</strong><small>carbohydrate</small></div><div><strong>75 g</strong><small>fat</small></div></div><div className={styles.meal}><strong>Breakfast</strong><p>Oats 80 g dry · Greek yoghurt 250 g ready-to-eat · blueberries 100 g</p></div><div className={styles.meal}><strong>Lunch</strong><p>Chicken breast 200 g raw · basmati rice 100 g dry · vegetables 200 g raw</p></div></section> : null}
    {section === "sessions" ? <section className={styles.card}><span className={styles.eyebrow}>SESSIONS / DIARY</span><h2>Coaching schedule</h2>{client.sessions.map(session => <div className={styles.row} key={session.id}><span><strong>{session.type}</strong><small>{session.when}</small></span>{session.type === "In-person PT" && session.status === "Upcoming" ? <button type="button" className={styles.primaryAction} onClick={() => setWorkout("In-person PT session")}>Begin Session</button> : <em className={styles.status}>{session.status}</em>}</div>)}</section> : null}
  </section>;
}
