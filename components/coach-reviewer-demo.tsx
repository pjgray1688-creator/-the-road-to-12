"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { CoachAccountActions } from "@/components/coach-account-actions";
import { CoachNutrition, type CoachNutritionData } from "@/components/coach-nutrition";
import { CoachProgrammeBuilder } from "@/components/coach-programme-builder";
import { CoachReviewerClientWorkspace } from "@/components/coach-reviewer-client-workspace";
import { CoachReviewerWorkout } from "@/components/coach-reviewer-workout";
import type { BuilderProgramme } from "@/lib/coach-programme-builder";
import { reviewerClients, reviewerProgrammes, type ReviewerClient } from "@/lib/coach-reviewer-fixtures";
import styles from "./coach-reviewer-demo.module.css";

export type CoachReviewerScreen = "clients" | "diary" | "programmes" | "nutrition" | "account";
const reviewerStorageKey = "r12-coach-reviewer-clients-v2";

function addedClient(name: string, email: string): ReviewerClient {
  return {
    id: "reviewer-" + Date.now(), name, email, relationship: "Simulated invitation", programmeName: "Programme not assigned", nutritionStatus: "Plan not assigned", weight: "Not recorded",
    measurements: [], personalBests: [], workouts: [], sessions: [], progressUpdate: "No progress update recorded yet.",
  };
}

function useReviewerClients() {
  const [clients, setClients] = useState<ReviewerClient[]>(reviewerClients);
  useEffect(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(reviewerStorageKey) ?? "[]") as unknown;
      if (!Array.isArray(parsed)) return;
      const safe = parsed.slice(0, 4).filter((item): item is ReviewerClient => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && typeof item.email === "string"));
      if (safe.length) queueMicrotask(() => setClients([...reviewerClients, ...safe]));
    } catch { /* Ignore malformed review-session state. */ }
  }, []);
  const addClient = (client: ReviewerClient) => {
    setClients(current => {
      const additions = [...current.filter(item => !reviewerClients.some(fixture => fixture.id === item.id)), client].slice(-4);
      sessionStorage.setItem(reviewerStorageKey, JSON.stringify(additions));
      return [...reviewerClients, ...additions];
    });
  };
  return { clients, addClient };
}

function Clients() {
  const { clients, addClient } = useReviewerClients();
  const [selected, setSelected] = useState<ReviewerClient | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  if (selected) return <CoachReviewerClientWorkspace client={selected} onBack={() => setSelected(null)}/>;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    if (!name || !email) return;
    addClient(addedClient(name, email));
    setMessage(name + " was added to this review session. No account or invitation was created.");
    setShowForm(false);
  };
  return <>
    <section className={styles.sectionHeading}><h1>Coach workspace</h1><button className={styles.primaryAction} type="button" onClick={() => setShowForm(value => !value)}>+ Add client</button></section>
    {showForm ? <form className={styles.card} onSubmit={submit}><h2>Add client</h2><p>Prepare a new coaching relationship.</p><div className={styles.formGrid}><label>Name<input name="name" defaultValue="Jordan Lee" maxLength={80} required /></label><label>Email<input name="email" type="email" defaultValue="jordan.lee@example.invalid" maxLength={120} required /></label></div><div className={styles.actions}><button className={styles.primaryAction} type="submit">Add client</button><button className={styles.secondaryAction} type="button" onClick={() => setShowForm(false)}>Cancel</button></div></form> : null}
    {message ? <p className={styles.sessionMessage} role="status">{message}</p> : null}
    <section className={styles.grid}><article className={styles.card}><span className={styles.eyebrow}>ACTIVE CLIENTS</span><h2>{clients.length}</h2><p>Independent and gym-linked coaching remain separate.</p></article><article className={styles.card}><span className={styles.eyebrow}>THIS WEEK</span><h2>2 coaching sessions</h2><p>1 in-person PT · 1 online review</p></article></section>
    <section className={styles.card}><div className={styles.rosterHeading}><div><span className={styles.eyebrow}>CLIENT ROSTER</span><h2>Active coaching relationships</h2></div><span>{clients.length} clients</span></div><div className={styles.roster}>{clients.map(client => <button type="button" className={styles.rosterRow} key={client.id} onClick={() => setSelected(client)}><span><strong>{client.name}</strong><small>{client.relationship} · {client.programmeName}</small></span><span><small>{client.sessions.find(session => session.status === "Upcoming")?.type ?? "No upcoming session"}</small><strong>Open workspace →</strong></span></button>)}</div></section>
  </>;
}

function Diary() {
  const [workoutClient, setWorkoutClient] = useState<ReviewerClient | null>(null);
  const [reviewClient, setReviewClient] = useState<ReviewerClient | null>(null);
  if (workoutClient) return <CoachReviewerWorkout client={workoutClient} title="In-person PT session" onClose={() => setWorkoutClient(null)}/>;
  if (reviewClient) return <CoachReviewerClientWorkspace client={reviewClient} onBack={() => setReviewClient(null)}/>;
  const alex = reviewerClients[0];
  const sophie = reviewerClients[1];
  return <section className={styles.card}><h1>Upcoming coaching</h1><p>In-person training and online reviews have distinct workflows.</p><div className={styles.row}><span><strong>Alex Taylor · In-person PT</strong><small>Today · 18:00–19:00</small></span><button type="button" className={styles.primaryAction} onClick={() => setWorkoutClient(alex)}>Begin Session</button></div><div className={styles.row}><span><strong>Sophie Bennett · Online review</strong><small>Friday · 17:30–18:00 · Video call</small></span><button type="button" className={styles.secondaryAction} onClick={() => setReviewClient(sophie)}>Review Client</button></div><div className={styles.row}><span><strong>Alex Taylor · Lower Strength</strong><small>Tuesday · Completed coaching session</small></span><em className={styles.status}>Completed</em></div></section>;
}

function Programmes() {
  const { clients } = useReviewerClients();
  const [programmes, setProgrammes] = useState(reviewerProgrammes);
  const [selectedId, setSelectedId] = useState(reviewerProgrammes[0].id);
  const [clientId, setClientId] = useState(reviewerClients[0].id);
  const [message, setMessage] = useState("");
  const selected = programmes.find(programme => programme.id === selectedId) ?? programmes[0];
  const selectedClient = clients.find(client => client.id === clientId) ?? clients[0];
  return <section className={styles.card}><h1>Training programmes</h1><p>Start from an existing template, give the programme its own name, then build sessions and training blocks.</p><div className={styles.selectionGrid}><label>Start from template<select value={selected.id} onChange={event => { setSelectedId(event.target.value); setMessage(""); }}>{programmes.map(programme => <option key={programme.id} value={programme.id}>{programme.name}</option>)}</select></label><label>Assign to client<select value={selectedClient.id} onChange={event => { setClientId(event.target.value); setMessage(""); }}>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label></div><CoachProgrammeBuilder key={selected.id + ":" + selectedClient.id} programme={selected} canManage clientUserId={selectedClient.id} organisationId={null} assignmentId={"reviewer-" + selectedClient.id} demoMode onSaved={saved => setProgrammes(current => current.map(item => item.id === saved.id ? saved : item))}/><div className={styles.actions}><button type="button" className={styles.primaryAction} onClick={() => setMessage(selected.name + " was assigned to " + selectedClient.name + " in this review session.")}>Assign and activate</button></div>{message ? <p className={styles.sessionMessage} role="status">{message}</p> : null}</section>;
}

const nutritionData: CoachNutritionData = {
  canManage: true, checkins: [], feedback: [],
  activePlan: {
    id: "reviewer-active-nutrition", status: "active", title: "Performance foundations", startDate: "2026-10-20", reviewDate: "2026-11-14", clientNotes: "Example targets for the current training block.", coachPrivateNotes: "",
    targets: { calories: 2600, protein: 190, carbs: 290, fat: 75 },
    meals: [
      { title: "Breakfast", timingText: "08:00", instructions: "Illustrative: 42 g protein · 80 g carbohydrate · 18 g fat · 650 kcal", items: [{ description: "Oats", portionText: "80 g dry" }, { description: "Greek yoghurt", portionText: "250 g ready-to-eat" }, { description: "Blueberries", portionText: "100 g" }, { description: "Peanut butter", portionText: "20 g" }] },
      { title: "Lunch", timingText: "13:00", instructions: "Illustrative: 58 g protein · 90 g carbohydrate · 17 g fat · 745 kcal", items: [{ description: "Chicken breast", portionText: "200 g raw" }, { description: "Basmati rice", portionText: "100 g dry (about 300 g cooked)" }, { description: "Mixed vegetables", portionText: "200 g raw" }, { description: "Olive oil", portionText: "10 g" }] },
      { title: "Pre-training", timingText: "16:30", instructions: "Illustrative: 28 g protein · 70 g carbohydrate · 3 g fat · 419 kcal", items: [{ description: "Banana", portionText: "120 g edible portion" }, { description: "Whey", portionText: "30 g dry" }, { description: "Rice cakes", portionText: "40 g" }, { description: "Honey", portionText: "15 g" }] },
      { title: "Dinner", timingText: "20:00", instructions: "Illustrative: 48 g protein · 45 g carbohydrate · 30 g fat · 642 kcal", items: [{ description: "Salmon", portionText: "180 g raw" }, { description: "Potatoes", portionText: "350 g raw (about 280 g cooked)" }, { description: "Green vegetables", portionText: "200 g raw" }] },
      { title: "Evening snack", timingText: "22:00", instructions: "Illustrative: 14 g protein · 5 g carbohydrate · 7 g fat · 139 kcal", items: [{ description: "Cottage cheese", portionText: "150 g ready-to-eat" }, { description: "Almonds", portionText: "15 g" }] },
    ], supplements: [],
  },
};

function Nutrition() {
  const [clientId, setClientId] = useState(reviewerClients[0].id);
  const client = reviewerClients.find(item => item.id === clientId) ?? reviewerClients[0];
  return <section className={styles.card}><h1>Client nutrition</h1><div className={styles.selectionGrid}><label>Client<select value={client.id} onChange={event => setClientId(event.target.value)}>{reviewerClients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><CoachNutrition key={client.id} clientUserId={client.id} clientName={client.name} initialData={nutritionData} demoMode embedded/></section>;
}

function Account({ email }: { email: string }) {
  return <section className={styles.card + " " + styles.account}><h1>Coach account</h1><p>{email}</p><div className={styles.row}><span><strong>Coach access</strong><small>App Review workspace</small></span><em className={styles.status}>Enabled</em></div><div className={styles.accountActions}><CoachAccountActions/><Link href="/coach/privacy">Privacy policy</Link><Link href="/account/delete?app=coach">Delete R12 account</Link></div><aside className={styles.disclosure} role="note" aria-label="App Review account disclosure"><strong>About this App Review account</strong><p>The people, plans and activity shown to this account are fictional. Add Client, programme, nutrition and workout changes remain in the review session and do not read or change real member, booking, payment or gym access records.</p></aside></section>;
}

export function CoachReviewerDemo({ screen, email = "appreview.staff@r12.live" }: { screen: CoachReviewerScreen; email?: string }) {
  return <main className={styles.page}>{screen === "clients" ? <Clients/> : screen === "diary" ? <Diary/> : screen === "programmes" ? <Programmes/> : screen === "nutrition" ? <Nutrition/> : <Account email={email}/>}</main>;
}
