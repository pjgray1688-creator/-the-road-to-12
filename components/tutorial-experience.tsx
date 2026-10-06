"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { coachTutorialSteps, madhouseTutorialSteps, memberTutorialSteps, tutorialVersion, type TutorialKey, type TutorialStep } from "@/lib/tutorials";
import styles from "./tutorial-experience.module.css";

type Context = { member_ready?: boolean; madhouse_connected?: boolean; coach_ready?: boolean; progress?: Array<{ tutorial_key: TutorialKey; version: number; status: "completed" | "skipped" }> };

function stepsFor(key: TutorialKey): TutorialStep[] { return key === "member_core" ? memberTutorialSteps : key === "madhouse_connected" ? madhouseTutorialSteps : coachTutorialSteps; }

export function TutorialExperience({ area, replayKey }: { area: "member" | "coach"; replayKey?: TutorialKey }) {
  const [context, setContext] = useState<Context>(); const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState(0); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/tutorials", { cache: "no-store" }); if (response.ok) setContext(await response.json()); }, []);
  useEffect(() => { let cancelled = false; void fetch("/api/tutorials", { cache: "no-store" }).then(response => response.ok ? response.json() : undefined).then(value => { if (!cancelled && value) setContext(value); }); return () => { cancelled = true; }; }, []);
  const automaticKey = useMemo<TutorialKey | null>(() => {
    if (!context) return null;
    const progress = (key: TutorialKey) => context.progress?.find(item => item.tutorial_key === key && item.version === tutorialVersion(key));
    const done = (key: TutorialKey) => Boolean(progress(key));
    if (area === "coach") return context.coach_ready && !done("coach_core") ? "coach_core" : null;
    if (context.member_ready && !done("member_core")) return "member_core";
    if (context.madhouse_connected && progress("member_core")?.status === "completed" && !done("madhouse_connected")) return "madhouse_connected";
    return null;
  }, [area, context]);
  const activeKey = dismissed ? null : replayKey ?? automaticKey;
  const steps = useMemo(() => activeKey ? stepsFor(activeKey) : [], [activeKey]); const current = steps[step];
  const finish = async (status: "completed" | "skipped") => {
    if (!activeKey || saving) return; setSaving(true); setError("");
    const response = await fetch("/api/tutorials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tutorialKey: activeKey, status }) });
    if (!response.ok) { setError("We couldn’t save your tutorial choice. Try again."); setSaving(false); return; }
    const finishedKey = activeKey;
    setContext(current => ({ ...current, progress: [...(current?.progress ?? []).filter(item => !(item.tutorial_key === finishedKey && item.version === tutorialVersion(finishedKey))), { tutorial_key: finishedKey, version: tutorialVersion(finishedKey), status }] }));
    if (replayKey) setDismissed(true); setStep(0); setSaving(false); await load();
  };
  if (!activeKey || !current) return null;
  return <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
    <section className={styles.panel} style={{ "--tutorial-steps": steps.length } as React.CSSProperties}>
      <div className={styles.top}><span className="eyebrow">{current.eyebrow}</span><span className={styles.count}>{step + 1} of {steps.length}</span></div>
      <h2 id="tutorial-title">{current.title}</h2><p>{current.body}</p>
      <div className={styles.progress} aria-hidden="true">{steps.map((_, index) => <span className={index <= step ? styles.active : ""} key={index} />)}</div>
      <div className={styles.actions}>{step === 0 ? <button className="text-button" type="button" disabled={saving} onClick={() => void finish("skipped")}>Skip</button> : <button className="secondary" type="button" onClick={() => setStep(value => value - 1)}>Back</button>}<button className={`primary ${styles.next}`} type="button" disabled={saving} onClick={() => step === steps.length - 1 ? void finish("completed") : setStep(value => value + 1)}>{saving ? "Saving…" : step === steps.length - 1 ? (activeKey === "coach_core" ? "Start coaching" : "Start using R12") : "Next"}</button></div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  </div>;
}
