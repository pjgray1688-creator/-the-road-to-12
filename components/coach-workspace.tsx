"use client";

import { useEffect, useState } from "react";
import { exerciseById } from "@/lib/workout";
import Link from "next/link";

type Client = { clientUserId: string; organisationId: string | null; assignmentId: string; relationshipId?: string; name: string; relationship: "primary" | "cover"; programmeName: string; programmeOwnerName: string; contextName?: string };
type PlannedDay = { id?: string; name?: string; exerciseIds?: string[]; exerciseOverrides?: Record<string, { name?: string; target?: string; sets?: number }> };
type ExerciseLog = { exerciseId: string; exerciseName: string; target: string; sets: Array<{ weight: string; reps: string; rir: string }> };
type CoachSession = { id: string; status: string; session_date?: string; notes: string; adaptations: string; substitutions: unknown[]; exercise_logs?: unknown[] };
type Detail = Client & { programme: { id?: string; name?: string; rationale?: string; week?: PlannedDay[] }; completedWorkouts: Array<{ id: string; name: string; completedAt?: string; sets: number }>; sessions: CoachSession[] };

function exerciseLogsFor(day: PlannedDay): ExerciseLog[] {
  return (day.exerciseIds ?? []).map(exerciseId => {
    const exercise = exerciseById(exerciseId);
    const override = day.exerciseOverrides?.[exerciseId];
    const count = override?.sets ?? exercise?.sets ?? 1;
    return { exerciseId, exerciseName: override?.name ?? exercise?.name ?? exerciseId, target: override?.target ?? exercise?.target ?? "Log the work completed", sets: Array.from({ length: count }, () => ({ weight: "", reps: "", rir: "" })) };
  });
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function CoachWorkspace({ initialClients }: { initialClients: Client[] }) {
  const [clients, setClients] = useState(initialClients);
  const [selected, setSelected] = useState<Client | null>(initialClients[0] ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [session, setSession] = useState<{ id: string; programmeSessionId: string; sessionName: string; exerciseLogs: ExerciseLog[] } | null>(null);
  const [notes, setNotes] = useState("");
  const [adaptations, setAdaptations] = useState("");
  const [substitutions, setSubstitutions] = useState("");
  const [message, setMessage] = useState("");
  const [showAddClient, setShowAddClient] = useState(false);
  const [clientEmail, setClientEmail] = useState("");
  const [relationshipType, setRelationshipType] = useState<"primary" | "cover">("primary");
  const [addingClient, setAddingClient] = useState(false);

  useEffect(() => {
    if (!selected) return;
    const context = new URLSearchParams({ assignmentId: selected.assignmentId });
    if (selected.organisationId) context.set("organisationId", selected.organisationId);
    if (selected.relationshipId) context.set("relationshipId", selected.relationshipId);
    void fetch(`/api/coach/clients/${selected.clientUserId}?${context}`).then(response => response.ok ? response.json() : null).then(result => setDetail(result?.client ?? null));
  }, [selected]);

  const selectClient = (client: Client) => {
    setDetail(null);
    setSession(null);
    setNotes("");
    setAdaptations("");
    setSubstitutions("");
    setMessage("");
    setSelected(client);
  };

  const refreshClients = async () => {
    const response = await fetch("/api/coach/clients", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json().catch(() => null);
    const next = Array.isArray(result?.clients) ? result.clients as Client[] : [];
    setClients(next);
    if (selected) setSelected(next.find(client => client.assignmentId === selected.assignmentId) ?? null);
  };

  const addClient = async () => {
    if (!clientEmail.trim() || addingClient) return;
    setAddingClient(true);
    setMessage("");
    const response = await fetch("/api/coach/relationships", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: clientEmail.trim(), relationshipType }),
    });
    const result = await response.json().catch(() => null);
    setAddingClient(false);
    if (!response.ok) { setMessage(result?.error ?? "That client could not be added."); return; }
    setClientEmail("");
    setShowAddClient(false);
    setMessage(result?.invited ? "Invitation prepared. Your client can create or sign in to R12 with that email." : "Connection request sent. Your client must accept it before coaching begins.");
    await refreshClients();
  };

  const startSession = async (day: PlannedDay) => {
    if (!selected || !day.id) return;
    const response = await fetch(`/api/coach/clients/${selected.clientUserId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId: selected.organisationId, assignmentId: selected.assignmentId, relationshipId: selected.relationshipId, idempotencyKey: crypto.randomUUID(), programmeSessionId: day.id }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Session could not be started."); return; }
    setSession({ id: result.session.id, programmeSessionId: day.id, sessionName: day.name ?? "Programme session", exerciseLogs: exerciseLogsFor(day) });
    setMessage("Session started. Your log is attached to today’s session only.");
  };

  const updateSet = (exerciseIndex: number, setIndex: number, field: "weight" | "reps" | "rir", value: string) => {
    setSession(current => current ? { ...current, exerciseLogs: current.exerciseLogs.map((exercise, index) => index !== exerciseIndex ? exercise : { ...exercise, sets: exercise.sets.map((set, index) => index !== setIndex ? set : { ...set, [field]: value }) }) } : current);
  };

  const saveSession = async (complete: boolean) => {
    if (!session) return;
    const exerciseLogs = session.exerciseLogs.map(exercise => ({ exerciseId: exercise.exerciseId, exerciseName: exercise.exerciseName, target: exercise.target, sets: exercise.sets.map(set => ({ weight: numberOrNull(set.weight), reps: numberOrNull(set.reps), rir: numberOrNull(set.rir) })) }));
    const response = await fetch(`/api/coach/sessions/${session.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes, adaptations, substitutions: substitutions.split("\n").map(value => value.trim()).filter(Boolean), exerciseLogs, complete }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Session could not be saved."); return; }
    if (result?.session && detail) {
      setDetail({ ...detail, sessions: [result.session, ...detail.sessions.filter(item => item.id !== result.session.id)] });
    }
    setMessage(complete ? "Session saved and attributed to you as cover PT." : "Session log saved.");
  };

  return <main className="coach-shell">
    <header className="coach-header"><div><span className="eyebrow">R12 COACH</span><h1>Coach workspace</h1><p>Keep clients, programmes and session notes together in R12.</p><div className="coach-header-actions"><button type="button" className="primary" onClick={() => setShowAddClient(true)}>Add client</button><Link className="text-button" href="/tutorial/coach">Replay Coach tutorial</Link></div></div></header>
    {showAddClient ? <section className="card coach-add-client" aria-labelledby="add-client-title"><div className="coach-section-heading"><div><span className="eyebrow">NEW CLIENT</span><h2 id="add-client-title">Connect a client</h2></div><button type="button" className="text-button" onClick={() => setShowAddClient(false)}>Close</button></div><p className="muted">Use your client’s exact email. We’ll connect an existing R12 account or prepare an invitation—no public people search.</p><label className="coach-field">Client email<input type="email" autoComplete="email" value={clientEmail} onChange={event => setClientEmail(event.target.value)} placeholder="client@example.com" /></label><label className="coach-field">Relationship<select value={relationshipType} onChange={event => setRelationshipType(event.target.value as "primary" | "cover")}><option value="primary">Primary PT</option><option value="cover">Cover PT</option></select></label><div className="coach-actions"><button type="button" className="secondary" onClick={() => setShowAddClient(false)}>Cancel</button><button type="button" className="primary" disabled={addingClient || !clientEmail.trim()} onClick={() => void addClient()}>{addingClient ? "Preparing…" : "Connect client"}</button></div></section> : null}
    <div className="coach-grid">
      <aside className="coach-client-list" aria-label="Authorised clients"><span className="eyebrow">CLIENTS</span>{clients.length ? clients.map(client => { const identity = `${client.organisationId ?? "direct"}:${client.assignmentId}`; return <button type="button" className={selected && `${selected.organisationId ?? "direct"}:${selected.assignmentId}` === identity ? "coach-client selected" : "coach-client"} key={identity} onClick={() => selectClient(client)}><strong>{client.name}</strong><small>{client.relationship === "cover" ? "Cover PT · " : "Primary PT · "}{client.programmeName}{client.contextName ? ` · ${client.contextName}` : ""}</small></button>; }) : <div className="coach-empty-clients"><h2>Add your first client</h2><p className="muted">Connect with an existing R12 user or invite a client to join.</p><button type="button" className="primary" onClick={() => setShowAddClient(true)}>Add client</button></div>}</aside>
      <section className="coach-content" aria-live="polite">
        {!selected ? <div className="card"><h2>Add your first client</h2><p className="muted">Connect with an existing R12 user or invite a client to join.</p><button type="button" className="primary" onClick={() => setShowAddClient(true)}>Add client</button></div> : !detail ? <div className="card"><p>Loading client plan…</p></div> : <>
          <div className="card coach-identity"><span className="eyebrow">CLIENT PROFILE</span><h2>{detail.name}</h2><p className="muted">{detail.relationship === "cover" ? `You are authorised to cover this session. Programme ownership remains with ${detail.programmeOwnerName}.` : `You are the primary PT for this programme.`}</p></div>
          <section className="card"><div className="coach-section-heading"><div><span className="eyebrow">READ-ONLY PROGRAMME</span><h2>{detail.programme?.name ?? detail.programmeName}</h2></div><span className="coach-lock">Primary PT owned</span></div><p className="muted">{detail.programme?.rationale ?? "Programme design and permanent changes are not editable in Coach."}</p>{(detail.programme?.week ?? []).map(day => <div className="coach-plan-row" key={day.id ?? day.name}><div><strong>{day.name ?? "Session"}</strong><small>{day.exerciseIds?.length ?? 0} programmed exercises</small></div>{day.exerciseIds?.length ? <button type="button" className="secondary coach-run" onClick={() => void startSession(day)} disabled={Boolean(session)}>Run this session</button> : null}</div>)}</section>
          <section className="card"><div className="coach-section-heading"><div><span className="eyebrow">TODAY&apos;S SESSION</span><h2>{session?.sessionName ?? "Session log"}</h2></div>{session ? <span className="coach-lock">Session-scoped</span> : <span className="muted">Choose a programmed session above</span>}</div>{message && <p className="coach-message" role="status">{message}</p>}{session && <>
            <p className="muted coach-log-boundary">These entries record what happened today. They do not change the programme.</p>
            <div className="coach-exercises">{session.exerciseLogs.map((exercise, exerciseIndex) => <fieldset className="coach-exercise" key={exercise.exerciseId}><legend><strong>{exercise.exerciseName}</strong><small>{exercise.target}</small></legend>{exercise.sets.map((set, setIndex) => <div className="coach-set" key={`${exercise.exerciseId}-${setIndex}`}><span className="coach-set-number">Set {setIndex + 1}</span><label>Load<input inputMode="decimal" type="number" min="0" step="any" value={set.weight} onChange={event => updateSet(exerciseIndex, setIndex, "weight", event.target.value)} /></label><label>Reps<input inputMode="numeric" type="number" min="0" step="1" value={set.reps} onChange={event => updateSet(exerciseIndex, setIndex, "reps", event.target.value)} /></label><label>RIR<input inputMode="numeric" type="number" min="0" step="1" value={set.rir} onChange={event => updateSet(exerciseIndex, setIndex, "rir", event.target.value)} /></label></div>)}</fieldset>)}</div>
            <label className="coach-field">Substitutions, one per line<textarea value={substitutions} onChange={event => setSubstitutions(event.target.value)} placeholder="e.g. Leg press → Goblet squat" /></label><label className="coach-field">Session adaptations<textarea value={adaptations} onChange={event => setAdaptations(event.target.value)} placeholder="What changed for today only?" /></label><label className="coach-field">Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Session observations" /></label><div className="coach-actions"><button type="button" className="secondary" onClick={() => void saveSession(false)}>Save session log</button><button type="button" className="primary" onClick={() => void saveSession(true)}>Complete session</button></div>
          </>}</section>
          <section className="card"><span className="eyebrow">COMPLETED WORKOUTS</span><h2>Client history</h2>{detail.completedWorkouts.length ? detail.completedWorkouts.slice(0, 8).map(workout => <div className="coach-history-row" key={workout.id}><strong>{workout.name}</strong><small>{workout.completedAt ? new Date(workout.completedAt).toLocaleDateString() : "Completed"} · {workout.sets} logged sets</small></div>) : <p className="muted">No completed workouts recorded yet.</p>}</section>
          <section className="card"><span className="eyebrow">COACH SESSION RECORDS</span><h2>Session attribution</h2>{detail.sessions.length ? detail.sessions.slice(0, 8).map(coachSession => <div className="coach-history-row" key={coachSession.id}><div><strong>{coachSession.status === "completed" ? "Completed coaching session" : "Session log in progress"}</strong><small>{coachSession.session_date ? new Date(`${coachSession.session_date}T00:00:00`).toLocaleDateString() : "Session date not recorded"} · Delivered by you · {detail.relationship === "cover" ? "cover PT" : "primary PT"}</small></div><small>{[coachSession.substitutions.length ? "Substitutions recorded" : "", coachSession.adaptations ? "Adaptation recorded" : "", coachSession.notes ? "Notes recorded" : ""].filter(Boolean).join(" · ") || "No additional session notes"}</small></div>) : <p className="muted">No Coach session records yet.</p>}</section>
        </>}
      </section>
    </div>
  </main>;
}
