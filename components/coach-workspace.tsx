"use client";

import { useEffect, useState } from "react";
import { exerciseById } from "@/lib/workout";
import { CoachDashboard } from "@/components/coach-dashboard";
import { CoachClientWorkspace, type CoachWorkspaceSection, type NutritionSummary } from "@/components/coach-client-workspace";
import { CoachProgrammeBlocks } from "@/components/coach-programme-blocks";
import type { BuilderProgramme } from "@/lib/coach-programme-builder";
import type { PlannedSession } from "@/lib/domain";

type Client = { clientUserId: string; organisationId: string | null; assignmentId: string; relationshipId?: string; name: string; relationship: "primary" | "cover"; programmeName: string; programmeOwnerName: string; contextName?: string };
type Pending = { id: string; name: string; email?: string | null; relationship: "primary" | "cover"; status: "pending"; createdAt?: string; contextName?: string; hasInvite?: boolean };
type Context = { organisationId: string; name: string };
type MemberResult = { userId: string; name: string; organisationId: string; organisationName: string; memberStatus: string };
type PlannedDay = PlannedSession;
type ExerciseLog = { exerciseId: string; exerciseName: string; target: string; sets: Array<{ weight: string; reps: string; rir: string }> };
type CoachSession = { id: string; status: string; session_date?: string; notes: string; adaptations: string; substitutions: unknown[]; exercise_logs?: unknown[] };
type Detail = Client & { programme: BuilderProgramme; completedWorkouts: Array<{ id: string; name: string; completedAt?: string; sets: number }>; sessions: CoachSession[] };

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

export function CoachWorkspace({ initialClients, initialPending, memberContexts, initialClientId, initialSection }: { initialClients: Client[]; initialPending: Pending[]; memberContexts: Context[]; initialClientId?: string; initialSection?: CoachWorkspaceSection }) {
  const [clients, setClients] = useState(initialClients);
  const [pending, setPending] = useState(initialPending);
  const [selected, setSelected] = useState<Client | null>(initialClients.find(client => client.clientUserId === initialClientId) ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [section, setSection] = useState<CoachWorkspaceSection>(initialSection ?? "overview");
  const [nutrition, setNutrition] = useState<NutritionSummary | null>(null);
  const [nutritionState, setNutritionState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [session, setSession] = useState<{ id: string; programmeSessionId: string; sessionName: string; exerciseLogs: ExerciseLog[] } | null>(null);
  const [notes, setNotes] = useState("");
  const [adaptations, setAdaptations] = useState("");
  const [substitutions, setSubstitutions] = useState("");
  const [message, setMessage] = useState("");
  const [showAddClient, setShowAddClient] = useState(false);
  const [mode, setMode] = useState<"madhouse" | "private">("madhouse");
  const [memberQuery, setMemberQuery] = useState("");
  const [members, setMembers] = useState<MemberResult[]>([]);
  const [memberContext, setMemberContext] = useState(memberContexts[0]?.organisationId ?? "");
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null);
  const [invitePath, setInvitePath] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [relationshipType, setRelationshipType] = useState<"primary" | "cover">("primary");
  const [addingClient, setAddingClient] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const context = new URLSearchParams({ assignmentId: selected.assignmentId });
    if (selected.organisationId) context.set("organisationId", selected.organisationId);
    if (selected.relationshipId) context.set("relationshipId", selected.relationshipId);
    void Promise.all([
      fetch(`/api/coach/clients/${selected.clientUserId}?${context}`).then(response => response.ok ? response.json() : null),
      fetch(`/api/coach/nutrition?client=${encodeURIComponent(selected.clientUserId)}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null),
    ]).then(([detailResult, nutritionResult]) => {
      if (cancelled) return;
      setDetail(detailResult?.client ?? null);
      setNutrition(nutritionResult ?? null);
      setNutritionState(nutritionResult ? "ready" : "unavailable");
    });
    return () => { cancelled = true; };
  }, [selected]);

  const selectClient = (client: Client) => {
    setDetail(null); setSession(null); setNotes(""); setAdaptations(""); setSubstitutions(""); setMessage(""); setSection("overview"); setNutrition(null); setNutritionState("loading"); setSelected(client);
  };

  const refreshClients = async () => {
    const response = await fetch("/api/coach/relationships", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json().catch(() => null);
    const next = Array.isArray(result?.clients) ? result.clients as Client[] : [];
    setClients(next); setPending(Array.isArray(result?.pending) ? result.pending as Pending[] : []);
    if (selected) setSelected(next.find(client => client.assignmentId === selected.assignmentId) ?? null);
  };

  const searchMembers = async () => {
    if (memberQuery.trim().length < 2 || !memberContext) return;
    const response = await fetch(`/api/coach/member-search?organisationId=${encodeURIComponent(memberContext)}&query=${encodeURIComponent(memberQuery.trim())}`, { cache: "no-store" });
    const result = await response.json().catch(() => null);
    setMembers(response.ok && Array.isArray(result?.members) ? result.members : []);
  };

  const addClient = async () => {
    if (addingClient || (mode === "madhouse" ? !selectedMember : false)) return;
    setAddingClient(true); setMessage("");
    const body = mode === "madhouse" ? { mode, clientUserId: selectedMember?.userId, organisationId: selectedMember?.organisationId, relationshipType } : { mode, email: clientEmail.trim(), relationshipType };
    const response = await fetch("/api/coach/relationships", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    setAddingClient(false);
    if (!response.ok) { setMessage(result?.error ?? "That client could not be added."); return; }
    if (mode === "private" && result?.invitePath) { setInvitePath(`${window.location.origin}${result.invitePath}`); setMessage("Your private-client invitation is ready to copy."); } else { setSelectedMember(null); setMemberQuery(""); setMembers([]); setMessage(result?.alreadyActive ? "This client is already in your client list." : "Connection request sent. It will appear under Pending until accepted."); }
    await refreshClients();
  };

  const pendingAction = async (item: Pending, action: "cancel" | "copy" | "resend") => {
    const response = await fetch("/api/coach/relationships", { method: action === "cancel" ? "DELETE" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ relationshipId: item.id, action }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "That pending connection could not be updated."); return; }
    if ((action === "resend" || action === "copy") && result?.invitePath) { if (action === "copy") await navigator.clipboard?.writeText(`${window.location.origin}${result.invitePath}`).catch(() => undefined); setMessage(action === "copy" ? "A fresh invitation link is copied to your clipboard." : "A fresh invitation email is queued."); } else setMessage("Pending connection cancelled.");
    await refreshClients();
  };

  const startSession = async (day: PlannedDay) => {
    if (!selected || !day.id) return;
    const response = await fetch(`/api/coach/clients/${selected.clientUserId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organisationId: selected.organisationId, assignmentId: selected.assignmentId, relationshipId: selected.relationshipId, idempotencyKey: crypto.randomUUID(), programmeSessionId: day.id }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Session could not be started."); return; }
    setSession({ id: result.session.id, programmeSessionId: day.id, sessionName: day.name ?? "Programme session", exerciseLogs: exerciseLogsFor(day) }); setMessage("Session started. Your log is attached to today’s session only."); setSection("programme");
  };

  const updateSet = (exerciseIndex: number, setIndex: number, field: "weight" | "reps" | "rir", value: string) => setSession(current => current ? { ...current, exerciseLogs: current.exerciseLogs.map((exercise, index) => index !== exerciseIndex ? exercise : { ...exercise, sets: exercise.sets.map((set, index) => index !== setIndex ? set : { ...set, [field]: value }) }) } : current);

  const saveSession = async (complete: boolean) => {
    if (!session) return;
    const exerciseLogs = session.exerciseLogs.map(exercise => ({ exerciseId: exercise.exerciseId, exerciseName: exercise.exerciseName, target: exercise.target, sets: exercise.sets.map(set => ({ weight: numberOrNull(set.weight), reps: numberOrNull(set.reps), rir: numberOrNull(set.rir) })) }));
    const response = await fetch(`/api/coach/sessions/${session.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes, adaptations, substitutions: substitutions.split("\n").map(value => value.trim()).filter(Boolean), exerciseLogs, complete }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Session could not be saved."); return; }
    if (result?.session && detail) setDetail({ ...detail, sessions: [result.session, ...detail.sessions.filter(item => item.id !== result.session.id)] });
    setMessage(complete ? "Session saved and attributed to you as cover PT." : "Session log saved.");
  };

  const programmeContent = detail ? <>
    <div aria-label="Programme with programmed exercises"><CoachProgrammeBlocks programme={detail.programme} canManage={detail.relationship === "primary"} clientUserId={detail.clientUserId} organisationId={detail.organisationId} assignmentId={detail.assignmentId} relationshipId={detail.relationshipId} onSaved={programme => setDetail(current => current ? { ...current, programme } : current)} onRunSession={day => void startSession(day)} /></div>
    <div className="coach-session-log"><div className="coach-section-heading"><div><span className="eyebrow">SESSION LOG</span><h3>{session?.sessionName ?? "Run an authorised session"}</h3></div>{session ? <span className="coach-lock">Session-scoped</span> : null}</div>{message ? <p className="coach-message" role="status">{message}</p> : null}{session ? <><p className="muted coach-log-boundary">These entries record what happened today. They do not change the programme.</p><div className="coach-exercises">{session.exerciseLogs.map((exercise, exerciseIndex) => <fieldset className="coach-exercise" key={exercise.exerciseId}><legend><strong>{exercise.exerciseName}</strong><small>{exercise.target}</small></legend>{exercise.sets.map((set, setIndex) => <div className="coach-set" key={`${exercise.exerciseId}-${setIndex}`}><span className="coach-set-number">Set {setIndex + 1}</span><label>Load<input inputMode="decimal" type="number" min="0" step="any" value={set.weight} onChange={event => updateSet(exerciseIndex, setIndex, "weight", event.target.value)} /></label><label>Reps<input inputMode="numeric" type="number" min="0" step="1" value={set.reps} onChange={event => updateSet(exerciseIndex, setIndex, "reps", event.target.value)} /></label><label>RIR<input inputMode="numeric" type="number" min="0" step="1" value={set.rir} onChange={event => updateSet(exerciseIndex, setIndex, "rir", event.target.value)} /></label></div>)}</fieldset>)}</div><label className="coach-field">Substitutions, one per line<textarea value={substitutions} onChange={event => setSubstitutions(event.target.value)} placeholder="e.g. Leg press → Goblet squat" /></label><label className="coach-field">Session adaptations<textarea value={adaptations} onChange={event => setAdaptations(event.target.value)} placeholder="What changed for today only?" /></label><label className="coach-field">Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Session observations" /></label><div className="coach-actions"><button type="button" className="secondary" onClick={() => void saveSession(false)}>Save session log</button><button type="button" className="primary" onClick={() => void saveSession(true)}>Complete session</button></div></> : <p className="muted">Choose a programmed session above to record what happened.</p>}</div>
  </> : null;

  return <main className="coach-shell"><header className="coach-header"><div><span className="eyebrow">R12 COACH</span><h1>Coach workspace</h1><p>Keep clients, programmes and session notes together in R12.</p><div className="coach-header-actions"><button type="button" className="primary coach-header-action" onClick={() => setShowAddClient(true)}><span className="coach-add-icon" aria-hidden="true">+</span>Add client</button></div></div></header>
    {showAddClient ? <section className="card coach-add-client" aria-labelledby="add-client-title"><div className="coach-section-heading"><div className="coach-add-client-heading"><span className="eyebrow">NEW CLIENT</span><h2 id="add-client-title">Add client</h2></div><button type="button" className="text-button coach-add-client-close" onClick={() => setShowAddClient(false)}>Close</button></div><div className="coach-mode-tabs" role="tablist"><button type="button" className={mode === "madhouse" ? "secondary selected" : "secondary"} onClick={() => setMode("madhouse")}>Madhouse member</button><button type="button" className={mode === "private" ? "secondary selected" : "secondary"} onClick={() => setMode("private")}>Private client</button></div>{mode === "madhouse" ? <><p className="muted">Search members at a Club venue you’re authorised to coach.</p>{memberContexts.length > 1 ? <label className="coach-field">Venue<select value={memberContext} onChange={event => setMemberContext(event.target.value)}>{memberContexts.map(context => <option key={context.organisationId} value={context.organisationId}>{context.name}</option>)}</select></label> : null}<div className="coach-member-search-control"><label className="coach-field">Search members<input value={memberQuery} onChange={event => setMemberQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void searchMembers(); }} placeholder="Search by name" /></label><button type="button" className="secondary coach-search-members-button" disabled={memberQuery.trim().length < 2} onClick={() => void searchMembers()}>Search members</button></div>{members.length ? <div className="coach-search-results">{members.map(member => <button type="button" className={selectedMember?.userId === member.userId ? "coach-search-result selected" : "coach-search-result"} key={member.userId} onClick={() => setSelectedMember(member)}><strong>{member.name}</strong><small>{member.organisationName} · Active member</small></button>)}</div> : null}{selectedMember ? <><p className="coach-message">Selected: {selectedMember.name}</p><label className="coach-field">Connection<select value={relationshipType} onChange={event => setRelationshipType(event.target.value as "primary" | "cover")}><option value="primary">Primary PT</option><option value="cover">Cover PT</option></select></label><button type="button" className="primary" disabled={addingClient} onClick={() => void addClient()}>{addingClient ? "Preparing…" : "Request connection"}</button></> : null}</> : <><p className="muted">Invite someone who is not a Madhouse member. They can use R12 with you without joining a gym.</p><label className="coach-field">Email (optional)<input type="email" autoComplete="email" value={clientEmail} onChange={event => setClientEmail(event.target.value)} placeholder="client@example.com" /></label><label className="coach-field">Connection<select value={relationshipType} onChange={event => setRelationshipType(event.target.value as "primary" | "cover")}><option value="primary">Primary PT</option><option value="cover">Cover PT</option></select></label><button type="button" className="primary" disabled={addingClient} onClick={() => void addClient()}>{addingClient ? "Preparing…" : "Create invite"}</button>{invitePath ? <div className="coach-message"><strong>Invitation link ready</strong><p className="muted">Share this link with your client.</p><button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(invitePath)}>Copy invite link</button></div> : null}</>}{message ? <p className="coach-message" role="status">{message}</p> : null}</section> : null}
    {!selected ? <CoachDashboard clients={clients} pending={pending} onSelectClient={selectClient} onPendingAction={(item, action) => void pendingAction(item, action)} /> : <div className="coach-grid"><aside className="coach-client-list" aria-label="Coach clients"><button type="button" className="coach-client-dashboard" onClick={() => { setSelected(null); setDetail(null); setSection("overview"); }}>Dashboard</button><span className="eyebrow">CLIENTS</span>{clients.length ? clients.map(client => { const identity = `${client.organisationId ?? "direct"}:${client.assignmentId}`; return <button type="button" className={selected && `${selected.organisationId ?? "direct"}:${selected.assignmentId}` === identity ? "coach-client selected" : "coach-client"} key={identity} onClick={() => selectClient(client)}><strong>{client.name}</strong><small>{client.relationship === "cover" ? "Cover PT · " : "Primary PT · "}{client.programmeName}{client.contextName ? ` · ${client.contextName}` : ""}</small></button>; }) : <p className="muted">No clients yet.</p>}{pending.length ? <div className="coach-pending"><span className="eyebrow">PENDING</span>{pending.map(item => <div className="coach-pending-row" key={item.id}><div className="coach-pending-heading"><strong>{item.name}</strong><span>{item.relationship === "cover" ? "Cover PT" : "Primary PT"}</span></div><small>{item.contextName ?? (item.email ? "Private client" : "Madhouse member")} · Awaiting acceptance{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString("en-GB")}` : ""}</small><div className="coach-pending-actions"><button type="button" className="text-button" onClick={() => void pendingAction(item, "copy")} aria-label={`Copy invite link for ${item.name}`}>Copy invite link</button>{item.email ? <button type="button" className="text-button" onClick={() => void pendingAction(item, "resend")} aria-label={`Resend invitation email to ${item.name}`}>Resend email</button> : null}<button type="button" className="text-button" onClick={() => void pendingAction(item, "cancel")} aria-label={`Cancel invitation for ${item.name}`}>Cancel</button></div></div>)}</div> : null}</aside><section className="coach-content" aria-live="polite">{!detail ? <div className="card"><p>Loading client workspace…</p></div> : <CoachClientWorkspace detail={detail} section={section} onSectionChange={setSection} nutrition={nutrition} nutritionState={nutritionState} programmeContent={programmeContent} />}</section></div>}
  </main>;
}
