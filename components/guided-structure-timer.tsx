"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlannedSessionStructure } from "@/lib/domain";
import { structureLabels, timedStructureState } from "@/lib/session-structures";

function clock(seconds: number) { const value = Math.max(0, Math.ceil(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; }

export function GuidedStructureTimer({ structure, exerciseNames = [], onFinish }: { structure: PlannedSessionStructure; exerciseNames?: string[]; onFinish?: () => void }) {
  const total = useMemo(() => timedStructureState(structure, 0).total, [structure]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedBeforePause, setElapsedBeforePause] = useState(0);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const finishedRef = useRef(false);
  const elapsed = startedAt === null ? elapsedBeforePause : elapsedBeforePause + (paused ? 0 : now - startedAt);
  const state = timedStructureState(structure, elapsed);
  const currentName = exerciseNames[state.stationIndex ?? 0] ?? "Next movement";

  useEffect(() => { if (startedAt === null || paused) return; const tick = () => { const timestamp = Date.now(); setNow(timestamp); if (total > 0 && elapsedBeforePause + (timestamp - startedAt) >= total && !finishedRef.current) { finishedRef.current = true; setPaused(true); onFinish?.(); } }; const id = window.setInterval(tick, 250); document.addEventListener("visibilitychange", tick); window.addEventListener("focus", tick); return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); }; }, [elapsedBeforePause, onFinish, paused, startedAt, total]);

  const start = () => { finishedRef.current = false; setStartedAt(Date.now()); setPaused(false); setNow(Date.now()); };
  const togglePause = () => { if (startedAt === null) return start(); if (paused) { setStartedAt(Date.now()); setPaused(false); setNow(Date.now()); } else { setElapsedBeforePause(elapsed); setStartedAt(null); setPaused(true); } };
  const finish = () => { setElapsedBeforePause(Math.min(total, elapsed)); setStartedAt(null); setPaused(true); onFinish?.(); };

  return <section className="card guided-structure-timer" aria-label={`${structureLabels[structure.type]} timer`}>
    <div className="guided-structure-timer-heading"><div><span className="eyebrow">{structureLabels[structure.type]}</span><strong>{structure.type === "interval" ? (state.phase === "rest" ? "REST" : "WORK") : "GUIDED SESSION"}</strong></div><span className="guided-structure-clock" aria-live="polite">{clock(state.remaining)}</span></div>
    <p className="guided-structure-timer-status">{structure.type === "emom" ? `Minute ${state.round} · ${currentName}` : structure.type === "amrap" ? `Keep moving · ${currentName}` : `Round ${state.round} · ${currentName}`}</p>
    <div className="guided-structure-actions"><button className="primary" type="button" onClick={togglePause}>{startedAt === null && !paused ? "Start timer" : paused ? "Resume" : "Pause"}</button><button className="tertiary-button" type="button" onClick={finish}>Finish structure</button></div>
  </section>;
}
