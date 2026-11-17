"use client";

import { useState, useTransition } from "react";
import { resetMyClubAccessPin, revealMyClubAccessPin } from "@/app/club/access/actions";
import styles from "@/components/club-my-access.module.css";

export function ClubAccessPinControls({ organisationId, canReset }: { organisationId: string; canReset: boolean }) {
  const [pin, setPin] = useState<string>();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const reveal = () => startTransition(async () => {
    setMessage("");
    if (pin) { setPin(undefined); return; }
    const result = await revealMyClubAccessPin(organisationId);
    if (result.ok) setPin(result.pin);
    else setMessage(result.error);
  });

  const reset = () => {
    if (!window.confirm("Reset your gym-entry PIN? Your current PIN will stop working immediately.")) return;
    startTransition(async () => {
      setMessage("");
      const result = await resetMyClubAccessPin(organisationId);
      setPin(undefined);
      setMessage(result.ok ? "Your PIN has been reset. Reveal PIN to view the new one." : result.error);
    });
  };

  return <div className="club-access-pin-controls">
    <div className="club-detail-row"><span>Personal access PIN</span><strong aria-live="polite" className={styles.pinValue}>{pin ?? "••••••••"}</strong></div>
    <div className={styles.actions}>
      <button className="secondary" type="button" onClick={reveal} disabled={pending}>{pending ? "Please wait…" : pin ? "Hide PIN" : "Reveal PIN"}</button>
      {canReset ? <button className="secondary" type="button" onClick={reset} disabled={pending}>Reset my PIN</button> : null}
    </div>
    {message ? <p role="status" className="muted">{message}</p> : null}
  </div>;
}
