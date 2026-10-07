"use client";

import { useEffect, useMemo, useState } from "react";
import { CoachProgrammeBuilder } from "@/components/coach-programme-builder";
import type { BuilderProgramme } from "@/lib/coach-programme-builder";
import type { PlannedSession } from "@/lib/domain";

type Block = { id: string; title: string; description?: string | null; coachNotes?: string | null; status: "draft" | "active" | "completed" | "archived"; plannedWeeks?: number | null; startDate?: string | null; targetEndDate?: string | null; updatedAt?: string; definition: BuilderProgramme };
type Props = { programme: BuilderProgramme; canManage: boolean; clientUserId: string; organisationId: string | null; assignmentId: string; relationshipId?: string; onSaved: (programme: BuilderProgramme) => void; onRunSession?: (session: PlannedSession) => void };

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function freshDefinition(source: BuilderProgramme, title: string): BuilderProgramme {
  const next = copy(source);
  next.id = crypto.randomUUID(); next.name = title;
  next.week = next.week.map((session, index) => ({ ...session, id: crypto.randomUUID(), day: index + 1 }));
  return next;
}

export function CoachProgrammeBlocks(props: Props) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fallback, setFallback] = useState(props.programme);
  const [message, setMessage] = useState("");
  const [revisions, setRevisions] = useState<Array<{ revision: number; changeNote?: string | null; createdAt: string }>>([]);
  const selected = blocks.find(block => block.id === selectedId) ?? null;
  const workingProgramme = selected?.definition ?? fallback;
  const query = useMemo(() => new URLSearchParams({ clientUserId: props.clientUserId, assignmentId: props.assignmentId }), [props.clientUserId, props.assignmentId]);

  const load = async () => {
    if (props.organisationId) query.set("organisationId", props.organisationId);
    if (props.relationshipId) query.set("relationshipId", props.relationshipId);
    const response = await fetch(`/api/coach/programme?${query}`, { cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Programme history is unavailable."); return; }
    const next = Array.isArray(result?.blocks) ? result.blocks as Block[] : [];
    setBlocks(next); setFallback(result?.legacyProgramme ?? props.programme);
    setSelectedId(current => current && next.some(block => block.id === current) ? current : next.find(block => block.status === "active")?.id ?? next[0]?.id ?? null);
  };
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [props.clientUserId, props.assignmentId, props.relationshipId, props.organisationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedId) return;
    void fetch("/api/coach/programme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revisions", clientUserId: props.clientUserId, organisationId: props.organisationId, assignmentId: props.assignmentId, relationshipId: props.relationshipId, blockId: selectedId }) }).then(response => response.json()).then(result => setRevisions(Array.isArray(result?.revisions) ? result.revisions : []));
  }, [selectedId, props.clientUserId, props.assignmentId, props.relationshipId, props.organisationId]);

  const create = async (source: BuilderProgramme, title: string, plannedWeeks: number | null = null) => {
    const definition = freshDefinition(source, title);
    const response = await fetch("/api/coach/programme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", clientUserId: props.clientUserId, organisationId: props.organisationId, assignmentId: props.assignmentId, relationshipId: props.relationshipId, title, plannedWeeks, definition }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Block could not be created."); return; }
    setMessage("Draft block created."); await load(); if (result?.id) setSelectedId(result.id);
  };
  const activate = async () => {
    if (!selected) return;
    const response = await fetch("/api/coach/programme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "activate", clientUserId: props.clientUserId, organisationId: props.organisationId, assignmentId: props.assignmentId, relationshipId: props.relationshipId, blockId: selected.id }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Block could not be activated."); return; }
    setMessage("Active block published to the member."); await load(); if (result?.generated_programme) props.onSaved(result.generated_programme as BuilderProgramme);
  };
  const setStatus = async (status: "completed" | "archived") => {
    if (!selected) return;
    const response = await fetch("/api/coach/programme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status", status, clientUserId: props.clientUserId, organisationId: props.organisationId, assignmentId: props.assignmentId, relationshipId: props.relationshipId, blockId: selected.id }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setMessage(result?.error ?? "Block could not be updated."); return; }
    setMessage(`Block marked ${status}.`); await load();
  };
  const onSaved = (next: BuilderProgramme) => { if (selected) setBlocks(current => current.map(block => block.id === selected.id ? { ...block, definition: next, title: next.name ?? block.title, updatedAt: new Date().toISOString() } : block)); else setFallback(next); props.onSaved(next); };

  return <div className="coach-programme-blocks">
    <div className="coach-programme-block-toolbar"><div><span className="eyebrow">PROGRAMME</span><h2>{selected?.title ?? fallback.name ?? "Programme"}</h2><p className="muted">Build the programme in blocks, keep previous work, and publish only when ready.</p></div>{props.canManage ? <button type="button" className="primary compact" onClick={() => void create(selected?.definition ?? fallback, "New block")}>+ New block</button> : null}</div>
    {blocks.length ? <div className="coach-programme-block-list" aria-label="Programme blocks">{blocks.map(block => <button type="button" key={block.id} className={block.id === selectedId ? "coach-programme-block selected" : "coach-programme-block"} onClick={() => setSelectedId(block.id)}><strong>{block.title}</strong><span>{block.status === "active" ? "Active" : block.status[0].toUpperCase() + block.status.slice(1)}{block.plannedWeeks ? ` · ${block.plannedWeeks} week${block.plannedWeeks === 1 ? "" : "s"}` : " · Open-ended"}</span></button>)}</div> : <div className="coach-empty-panel"><h3>{props.canManage ? "Start your first block" : "No saved block history yet"}</h3><p className="muted">{props.canManage ? "Create a draft from the current programme, then activate it when it is ready." : "There is no persistent block history to display yet."}</p>{props.canManage ? <button type="button" className="secondary" onClick={() => void create(fallback, fallback.name || "First block")}>Create first block</button> : null}</div>}
    {selected ? <div className="coach-programme-block-detail"><div className="coach-programme-block-meta"><span className={`coach-block-status ${selected.status}`}>{selected.status}</span>{selected.plannedWeeks ? <span>{selected.plannedWeeks} weeks</span> : <span>Open-ended</span>}{selected.startDate ? <span>Started {selected.startDate}</span> : null}{props.canManage && selected.status === "draft" ? <button type="button" className="secondary compact" onClick={() => void activate()}>Activate block</button> : null}{props.canManage ? <button type="button" className="secondary compact" onClick={() => void create(selected.definition, `${selected.title} — next` , selected.plannedWeeks ?? null)}>Duplicate as draft</button> : null}{props.canManage && selected.status === "active" ? <button type="button" className="secondary compact" onClick={() => void setStatus("completed")}>Complete block</button> : null}{props.canManage && selected.status === "draft" ? <button type="button" className="text-button" onClick={() => void setStatus("archived")}>Archive draft</button> : null}</div><CoachProgrammeBuilder {...props} programme={workingProgramme} blockId={selected.id} onSaved={onSaved} /><aside className="coach-revision-history"><span className="eyebrow">REVISION HISTORY</span>{revisions.length ? revisions.slice(0, 8).map(revision => <p key={revision.revision}><strong>Revision {revision.revision}</strong><small>{revision.changeNote || "Programme updated"} · {new Date(revision.createdAt).toLocaleDateString("en-GB")}</small></p>) : <p className="muted">Saved changes will appear here.</p>}</aside></div> : null}
    {message ? <p className="coach-message" role="status">{message}</p> : null}
  </div>;
}
