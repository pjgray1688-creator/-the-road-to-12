"use client";

import { useMemo, useState } from "react";
import { exerciseKnowledge, type PrescriptionMetric } from "@/lib/exercise-library";
import { exerciseById } from "@/lib/workout";
import { addExercise, builderKnowledge, builderMetricLabels, builderSearch, filterOptions, moveExercise, moveSession, newProgrammeSession, removeExercise, updateOverride, type BuilderProgramme } from "@/lib/coach-programme-builder";
import type { PlannedExerciseOverride, PlannedSession } from "@/lib/domain";

type Props = {
  programme: BuilderProgramme;
  canManage: boolean;
  clientUserId: string;
  organisationId: string | null;
  assignmentId: string;
  relationshipId?: string;
  blockId?: string;
  onSaved: (programme: BuilderProgramme) => void;
  onRunSession?: (session: PlannedSession) => void;
};

const options = filterOptions();

function cloneProgramme(programme: BuilderProgramme): BuilderProgramme {
  return JSON.parse(JSON.stringify(programme)) as BuilderProgramme;
}

function inputValue(override: PlannedExerciseOverride | undefined, field: keyof PlannedExerciseOverride) {
  const value = override?.[field];
  return value === undefined || value === null ? "" : String(value);
}

function numericField(field: keyof PlannedExerciseOverride) {
  return ["sets", "rir", "rpe", "restSeconds", "calories", "speed", "incline", "cadence", "heartRate", "rounds"].includes(field);
}

function overrideField(metric: PrescriptionMetric): keyof PlannedExerciseOverride {
  return metric === "RIR" ? "rir" : metric === "RPE" ? "rpe" : metric as keyof PlannedExerciseOverride;
}

export function CoachProgrammeBuilder({ programme, canManage, clientUserId, organisationId, assignmentId, relationshipId, blockId, onSaved, onRunSession }: Props) {
  const [working, setWorking] = useState(() => cloneProgramme(programme));
  const [selectedSessionId, setSelectedSessionId] = useState(working.week[0]?.id ?? "");
  const [openExercise, setOpenExercise] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [equipment, setEquipment] = useState("");
  const [muscle, setMuscle] = useState("");
  const [movementPattern, setMovementPattern] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");

  const results = useMemo(() => builderSearch(query, {
    equipment: equipment || undefined,
    muscle: muscle || undefined,
    movementPattern: movementPattern || undefined,
  }), [query, equipment, muscle, movementPattern]);
  const selectedSession = working.week.find(session => session.id === selectedSessionId) ?? working.week[0];

  const change = (next: BuilderProgramme) => { setWorking(next); setDirty(true); setMessage(""); };
  const updateSession = (sessionId: string, update: (session: PlannedSession) => PlannedSession) => change({ ...working, week: working.week.map(session => session.id === sessionId ? update(session) : session) });

  const addSession = () => {
    const next = newProgrammeSession(working.week.length);
    change({ ...working, week: [...working.week, next] });
    setSelectedSessionId(next.id);
  };

  const save = async () => {
    if (!canManage || saving) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/coach/programme", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientUserId, organisationId, assignmentId, relationshipId, blockId, programme: working }) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.definition && !result?.generated_programme) throw new Error(result?.error ?? "Programme could not be saved");
      const saved = (result.definition ?? result.generated_programme) as BuilderProgramme;
      setWorking(cloneProgramme(saved)); setDirty(false); setMessage("Programme saved."); onSaved(saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Programme could not be saved.");
    } finally { setSaving(false); }
  };

  const setOverride = (sessionId: string, exerciseId: string, field: keyof PlannedExerciseOverride, raw: string) => {
    const value = numericField(field) ? (raw === "" ? undefined : Number(raw)) : raw;
    updateSession(sessionId, session => updateOverride(session, exerciseId, { [field]: value }));
  };

  return <div className="coach-builder">
    <div className="coach-builder-toolbar">
      <div><span className="eyebrow">PROGRAMME BUILDER</span><p className="muted">{canManage ? "Build the prescription your client will follow." : "Read only while covering. Session logs remain available separately."}</p></div>
      <div className="coach-builder-status" aria-live="polite">{dirty ? "Unsaved changes" : message || "Saved"}</div>
    </div>
    <div className="coach-builder-header">
      <label className="coach-field">Programme name<input disabled={!canManage} value={working.name ?? ""} onChange={event => change({ ...working, name: event.target.value })} placeholder="Programme name" /></label>
      {canManage ? <button type="button" className="primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? "Saving…" : "Save programme"}</button> : <span className="coach-lock">Primary PT owned</span>}
    </div>
    <div className="coach-builder-layout">
      <aside className="coach-builder-sessions" aria-label="Programme sessions">
        <div className="coach-section-heading"><h3>Sessions</h3>{canManage ? <button type="button" className="secondary compact" onClick={addSession}>+ Add session</button> : null}</div>
        {working.week.length ? working.week.map((session, index) => <div className={selectedSession?.id === session.id ? "coach-builder-session selected" : "coach-builder-session"} key={session.id}>
          <button type="button" className="coach-builder-session-select" onClick={() => setSelectedSessionId(session.id)}><strong>{session.name || `Session ${index + 1}`}</strong><small>{session.exerciseIds.length} exercise{session.exerciseIds.length === 1 ? "" : "s"}</small></button>
          {canManage ? <div className="coach-builder-inline-actions"><button type="button" className="text-button" disabled={index === 0} onClick={() => change({ ...working, week: moveSession(working.week, index, -1) })} aria-label={`Move ${session.name} up`}>↑</button><button type="button" className="text-button" disabled={index === working.week.length - 1} onClick={() => change({ ...working, week: moveSession(working.week, index, 1) })} aria-label={`Move ${session.name} down`}>↓</button></div> : null}
        </div>) : <p className="muted">No sessions yet.</p>}
      </aside>
      <section className="coach-builder-main" aria-label="Selected programme session">
        {selectedSession ? <>
          <div className="coach-section-heading"><div><span className="eyebrow">SESSION {selectedSession.day}</span>{canManage ? <input className="coach-builder-session-name" value={selectedSession.name} onChange={event => updateSession(selectedSession.id, session => ({ ...session, name: event.target.value }))} aria-label="Session name" /> : <h3>{selectedSession.name}</h3>}<small className="muted">{selectedSession.exerciseIds.length} programmed exercises</small></div>{canManage ? <button type="button" className="danger compact" onClick={() => { const next = working.week.filter(session => session.id !== selectedSession.id); change({ ...working, week: next }); setSelectedSessionId(next[0]?.id ?? ""); }}>Remove session</button> : null}</div>
          {canManage ? <div className="coach-builder-exercise-picker"><label className="coach-field">Add exercise<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search exercises or aliases" /></label><div className="coach-builder-filters"><select aria-label="Filter equipment" value={equipment} onChange={event => setEquipment(event.target.value)}><option value="">All equipment</option>{options.equipment.map(value => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Filter muscle" value={muscle} onChange={event => setMuscle(event.target.value)}><option value="">All muscles</option>{options.muscle.map(value => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Filter movement" value={movementPattern} onChange={event => setMovementPattern(event.target.value)}><option value="">All movement</option>{options.movementPattern.map(value => <option key={value} value={value}>{value}</option>)}</select></div>{query || equipment || muscle || movementPattern ? <div className="coach-builder-search-results" role="listbox" aria-label="Exercise results">{results.length ? results.map(item => <button type="button" key={item.id} className="coach-builder-result" onClick={() => { change({ ...working, week: working.week.map(session => session.id === selectedSession.id ? addExercise(session, item.id) : session) }); setOpenExercise(`${selectedSession.id}:${item.id}`); setQuery(""); }}><span><strong>{item.name}</strong><small>{item.equipmentRequired.join(" · ")} · {item.primaryMuscles.slice(0, 2).join(", ")}</small></span>{item.reviewStatus === "manual-review" ? <em>Review</em> : null}</button>) : <p className="muted">No matching exercises.</p>}</div> : null}</div> : null}
          <div className="coach-builder-exercises">{selectedSession.exerciseIds.length ? selectedSession.exerciseIds.map((exerciseId, index) => { const exercise = exerciseById(exerciseId); const knowledge = builderKnowledge(exerciseId); const override = selectedSession.exerciseOverrides?.[exerciseId]; const expanded = openExercise === `${selectedSession.id}:${exerciseId}`; return <article className="coach-builder-exercise" key={`${selectedSession.id}:${exerciseId}`}><div className="coach-builder-exercise-heading"><button type="button" className="coach-builder-exercise-toggle" onClick={() => setOpenExercise(expanded ? null : `${selectedSession.id}:${exerciseId}`)}><strong>{knowledge?.name ?? exercise?.name ?? exerciseId}</strong><small>{knowledge?.equipmentRequired.join(" · ") ?? "Equipment not recorded"}{knowledge?.unilateral ? " · Unilateral" : ""}</small></button>{knowledge?.reviewStatus === "manual-review" ? <span className="coach-review-badge">Review</span> : null}<div className="coach-builder-inline-actions">{canManage ? <><button type="button" className="text-button" disabled={index === 0} onClick={() => updateSession(selectedSession.id, session => moveExercise(session, index, -1))} aria-label="Move exercise up">↑</button><button type="button" className="text-button" disabled={index === selectedSession.exerciseIds.length - 1} onClick={() => updateSession(selectedSession.id, session => moveExercise(session, index, 1))} aria-label="Move exercise down">↓</button><button type="button" className="text-button" onClick={() => updateSession(selectedSession.id, session => removeExercise(session, exerciseId))}>Remove</button></> : null}</div></div>{expanded ? <div className="coach-builder-exercise-detail"><div className="coach-builder-prescription-fields"><label>Sets<input disabled={!canManage} type="number" min="1" max="30" value={inputValue(override, "sets")} onChange={event => setOverride(selectedSession.id, exerciseId, "sets", event.target.value)} /></label>{(knowledge?.supportedPrescriptionMetrics ?? ["reps"]).map(metric => { const field = overrideField(metric); return <label key={metric}>{builderMetricLabels[metric]}<input disabled={!canManage} type={numericField(field) ? "number" : "text"} value={inputValue(override, field)} onChange={event => setOverride(selectedSession.id, exerciseId, field, event.target.value)} /></label>; })}<label>Rest (sec)<input disabled={!canManage} type="number" min="0" value={inputValue(override, "restSeconds")} onChange={event => setOverride(selectedSession.id, exerciseId, "restSeconds", event.target.value)} /></label><label>Tempo<input disabled={!canManage} value={inputValue(override, "tempo")} onChange={event => setOverride(selectedSession.id, exerciseId, "tempo", event.target.value)} placeholder="e.g. 3-1-1" /></label></div><label className="coach-field">Notes<textarea disabled={!canManage} value={inputValue(override, "notes")} onChange={event => setOverride(selectedSession.id, exerciseId, "notes", event.target.value)} placeholder="Coaching cues or prescription notes" /></label>{knowledge?.substitutions.length || knowledge?.progressionOptions.length || knowledge?.regressionOptions.length ? <div className="coach-builder-suggestions"><strong>Suggestions</strong>{[...(knowledge.substitutions.length ? [{ label: "Substitutions", ids: knowledge.substitutions }] : []), ...(knowledge.progressionOptions.length ? [{ label: "Progressions", ids: knowledge.progressionOptions }] : []), ...(knowledge.regressionOptions.length ? [{ label: "Regressions", ids: knowledge.regressionOptions }] : [])].map(group => <div key={group.label}><small>{group.label}</small><span>{group.ids.map(id => <button type="button" className="text-button" key={id} onClick={() => setQuery(exerciseKnowledge(id)?.name ?? id)}>{exerciseKnowledge(id)?.name ?? id}</button>)}</span></div>)}</div> : null}</div> : null}</article>; }) : <div className="coach-empty-panel"><h3>No exercises in this session</h3><p className="muted">Search the library above to add the first exercise.</p></div>}</div>
          {selectedSession.exerciseIds.length && onRunSession ? <button type="button" className="secondary" onClick={() => onRunSession(selectedSession)}>Run this session</button> : null}
        </> : <div className="coach-empty-panel"><h3>No programme sessions</h3><p className="muted">{canManage ? "Add a session to start building this programme." : "There is no assigned programme to display yet."}</p></div>}
      </section>
    </div>
  </div>;
}
