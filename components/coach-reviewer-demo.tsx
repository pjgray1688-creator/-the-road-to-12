"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { CoachAccountActions } from "@/components/coach-account-actions";
import { CoachProgrammeBuilder } from "@/components/coach-programme-builder";
import type { BuilderProgramme } from "@/lib/coach-programme-builder";
import styles from "./coach-reviewer-demo.module.css";

export type CoachReviewerScreen = "clients" | "diary" | "programmes" | "nutrition" | "account";

type ReviewerClient = { id: string; name: string; email: string; relationship: string };

const reviewerStorageKey = "r12-coach-reviewer-clients-v1";
const alex: ReviewerClient = { id: "reviewer-alex", name: "Alex Taylor", email: "alex.taylor@example.invalid", relationship: "Independent client" };

const foundationStrength: BuilderProgramme = {
  id: "reviewer-foundation-strength",
  name: "Foundation Strength",
  rationale: "A fictional two-day strength example for App Review.",
  week: [
    { id: "reviewer-lower", day: 1, name: "Lower strength", status: "planned", exerciseIds: ["trap-bar-deadlift", "leg-press", "romanian-deadlift"], exerciseOverrides: {
      "trap-bar-deadlift": { sets: 4, reps: "5", load: "RPE 7", restSeconds: 180 },
      "leg-press": { sets: 3, reps: "10", rir: 2, restSeconds: 120 },
      "romanian-deadlift": { sets: 3, reps: "8", rir: 2, restSeconds: 150 },
    } },
    { id: "reviewer-upper", day: 2, name: "Upper strength", status: "planned", exerciseIds: ["flat-bench", "barbell-row", "lat-pulldown"], exerciseOverrides: {
      "flat-bench": { sets: 4, reps: "6", load: "RPE 7", restSeconds: 150 },
      "barbell-row": { sets: 4, reps: "8", rir: 2, restSeconds: 120 },
      "lat-pulldown": { sets: 3, reps: "10", rir: 2, restSeconds: 90 },
    } },
  ],
};

const performanceBase: BuilderProgramme = {
  id: "reviewer-performance-base",
  name: "Performance Base",
  rationale: "A fictional full-body template for App Review.",
  week: [{ id: "reviewer-full-body", day: 1, name: "Full body", status: "planned", exerciseIds: ["leg-press", "flat-bench", "barbell-row"], exerciseOverrides: {
    "leg-press": { sets: 4, reps: "8", rir: 2, restSeconds: 120 },
    "flat-bench": { sets: 3, reps: "8", rir: 2, restSeconds: 120 },
    "barbell-row": { sets: 3, reps: "10", rir: 2, restSeconds: 90 },
  } }],
};

const initialProgrammes = [foundationStrength, performanceBase];

function useReviewerClients() {
  const [clients, setClients] = useState<ReviewerClient[]>([alex]);
  useEffect(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(reviewerStorageKey) ?? "[]") as unknown;
      if (!Array.isArray(parsed)) return;
      const safe = parsed.slice(0, 4)
        .filter((item): item is ReviewerClient => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && typeof item.email === "string" && typeof item.relationship === "string"))
        .map(item => ({ ...item, name: item.name.slice(0, 80), email: item.email.slice(0, 120), relationship: item.relationship.slice(0, 40) }));
      if (safe.length) queueMicrotask(() => setClients([alex, ...safe.filter(item => item.id !== alex.id)]));
    } catch { /* Ignore malformed browser-only demo state. */ }
  }, []);
  const addClient = (client: ReviewerClient) => {
    setClients(current => {
      const next = [...current, client].slice(0, 5);
      sessionStorage.setItem(reviewerStorageKey, JSON.stringify(next.filter(item => item.id !== alex.id)));
      return next;
    });
  };
  return { clients, addClient };
}

function Clients() {
  const { clients, addClient } = useReviewerClients();
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    if (!name || !email) return;
    addClient({ id: `reviewer-${Date.now()}`, name, email, relationship: "Simulated invitation" });
    setMessage(`${name} was added to this browser session only. No invitation was sent.`);
    setShowForm(false);
  };
  return <>
    <section className={styles.sectionHeading}><h1>Coach workspace</h1><button className={styles.primaryAction} type="button" onClick={() => setShowForm(value => !value)}>+ Add client</button></section>
    {showForm ? <form className={styles.card} onSubmit={submit}><h2>Simulate a client invitation</h2><p>This App Review form stores fictional details in this browser session. It does not create an account or send an invitation.</p><div className={styles.formGrid}><label>Name<input name="name" defaultValue="Jordan Lee" maxLength={80} required /></label><label>Email<input name="email" type="email" defaultValue="jordan.lee@example.invalid" maxLength={120} required /></label></div><div className={styles.actions}><button className={styles.primaryAction} type="submit">Add synthetic client</button><button className={styles.secondaryAction} type="button" onClick={() => setShowForm(false)}>Cancel</button></div></form> : null}
    {message ? <p className={styles.sessionMessage} role="status">{message}</p> : null}
    <section className={styles.grid}><article className={styles.card}><span className={styles.eyebrow}>ACTIVE CLIENTS</span><h2>{clients.length}</h2><p>Independent and gym-linked coaching remain separate.</p></article><article className={styles.card}><span className={styles.eyebrow}>THIS WEEK</span><h2>2 sessions</h2><p>One completed, one scheduled.</p></article></section>
    <section className={styles.card}><span className={styles.eyebrow}>CLIENT WORKSPACE</span>{clients.map((client, index) => <div className={styles.client} key={client.id}><div><h2>{client.name}</h2><p>{client.relationship} · {client.email}</p></div><em className={styles.status}>{index === 0 ? "On track" : "Session only"}</em>{index === 0 ? <><div className={styles.row}><span><strong>Foundation Strength</strong><small>Two-day example programme · active</small></span><em className={styles.status}>Active</em></div><div className={styles.row}><span><strong>Nutrition plan</strong><small>Performance foundations · review Friday</small></span><em className={styles.status}>Active</em></div></> : null}</div>)}</section>
  </>;
}

function Diary() {
  return <section className={styles.card}><h1>Upcoming sessions</h1><p>This fictional preview contains no real bookings and grants no gym staff schedule permission.</p><div className={styles.row}><span><strong>Alex Taylor · Strength session</strong><small>Today · 18:00–19:00 · Independent coaching</small></span><em className={styles.status}>Scheduled</em></div><div className={styles.row}><span><strong>Alex Taylor · Progress review</strong><small>Friday · 17:30–18:00 · Video call</small></span><em className={styles.status}>Scheduled</em></div></section>;
}

function Programmes() {
  const { clients } = useReviewerClients();
  const [programmes, setProgrammes] = useState(initialProgrammes);
  const [selectedId, setSelectedId] = useState(initialProgrammes[0].id);
  const [clientId, setClientId] = useState(alex.id);
  const [message, setMessage] = useState("");
  const selected = programmes.find(programme => programme.id === selectedId) ?? programmes[0];
  const selectedClient = clients.find(client => client.id === clientId) ?? clients[0];
  return <section className={styles.card}><h1>Training programmes</h1><p>Select a fictional template, edit its sessions and prescriptions, then simulate assignment. Changes remain in this browser session.</p><div className={styles.selectionGrid}><label>Programme<select value={selected.id} onChange={event => { setSelectedId(event.target.value); setMessage(""); }}>{programmes.map(programme => <option key={programme.id} value={programme.id}>{programme.name}</option>)}</select></label><label>Client<select value={selectedClient.id} onChange={event => { setClientId(event.target.value); setMessage(""); }}>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label></div><CoachProgrammeBuilder key={`${selected.id}:${selectedClient.id}`} programme={selected} canManage clientUserId={selectedClient.id} organisationId={null} assignmentId={`reviewer-${selectedClient.id}`} demoMode onSaved={saved => setProgrammes(current => current.map(item => item.id === saved.id ? saved : item))}/><div className={styles.actions}><button type="button" className={styles.primaryAction} onClick={() => setMessage(`${selected.name} was assigned to ${selectedClient.name} in this browser session only.`)}>Assign and activate</button></div>{message ? <p className={styles.sessionMessage} role="status">{message}</p> : null}</section>;
}

const meals = [
  ["Breakfast", "Oats 80 g dry · Greek yoghurt 250 g ready-to-eat · blueberries 100 g · peanut butter 20 g", "42 g protein · 80 g carbohydrate · 18 g fat · 650 kcal"],
  ["Lunch", "Chicken breast 200 g raw · basmati rice 100 g dry (about 300 g cooked) · mixed vegetables 200 g raw · olive oil 10 g", "58 g protein · 90 g carbohydrate · 17 g fat · 745 kcal"],
  ["Pre-training", "Banana 120 g edible portion · whey 30 g dry · rice cakes 40 g · honey 15 g", "28 g protein · 70 g carbohydrate · 3 g fat · 419 kcal"],
  ["Dinner", "Salmon 180 g raw · potatoes 350 g raw (about 280 g cooked) · green vegetables 200 g raw", "48 g protein · 45 g carbohydrate · 30 g fat · 642 kcal"],
  ["Evening snack", "Cottage cheese 150 g ready-to-eat · almonds 15 g", "14 g protein · 5 g carbohydrate · 7 g fat · 139 kcal"],
];

function Nutrition() {
  return <><section className={styles.card}><h1>Alex Taylor · Performance foundations</h1><p>This is fictional App Review data for demonstrating Coach tools. It is not a recommendation for a real person.</p><div className={styles.targetGrid}><div><strong>2,600</strong><small>kcal · rounded target</small></div><div><strong>190 g</strong><small>protein</small></div><div><strong>290 g</strong><small>carbohydrate</small></div><div><strong>75 g</strong><small>fat</small></div></div><p className={styles.muted}>The macro targets provide approximately 2,595 kcal; 2,600 kcal is the rounded daily target.</p></section><section className={styles.card}><span className={styles.eyebrow}>EXAMPLE DAY</span><h2>Weighed portions</h2>{meals.map(([name, portions, macros]) => <div className={styles.meal} key={name}><strong>{name}</strong><p>{portions}</p><small>{macros}</small></div>)}</section></>;
}

function Account({ email }: { email: string }) {
  return <section className={`${styles.card} ${styles.account}`}><h1>App Review Demo</h1><p>{email}</p><div className={styles.row}><span><strong>Coach access</strong><small>Synthetic App Review workspace</small></span><em className={styles.status}>Enabled</em></div><div className={styles.accountActions}><CoachAccountActions/><Link href="/coach/privacy">Privacy policy</Link><Link href="/account/delete">Delete R12 account</Link></div><aside className={styles.disclosure} role="note" aria-label="App Review demonstration disclosure"><strong>About this demonstration</strong><p>People, plans and activity are fictional. Interactive changes remain in this browser session; no real member, booking, payment or gym access records are read or changed.</p></aside></section>;
}

export function CoachReviewerDemo({ screen, email = "staff@r12.live" }: { screen: CoachReviewerScreen; email?: string }) {
  return <main className={styles.page}>{screen === "clients" ? <Clients/> : screen === "diary" ? <Diary/> : screen === "programmes" ? <Programmes/> : screen === "nutrition" ? <Nutrition/> : <Account email={email}/>}</main>;
}
