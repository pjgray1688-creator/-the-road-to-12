"use client";

import { useState } from "react";

export function CoachRelationshipClaim() {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const claim = async () => {
    setState("working");
    const response = await fetch("/api/coach/relationships/claim", { method: "POST" });
    setState(response.ok ? "done" : "error");
  };
  return <main className="shell"><section className="card"><span className="eyebrow">R12 COACH</span><h1>Accept coaching connection</h1><p className="muted">Sign in with the email your PT used. Accepting connects this account to the pending coaching relationship.</p><button type="button" className="primary" disabled={state === "working"} onClick={() => void claim()}>{state === "working" ? "Connecting…" : "Accept connection"}</button>{state === "done" ? <p role="status">Connection accepted. You can now open R12 Coach.</p> : null}{state === "error" ? <p role="alert">We could not accept that connection. Check that you are signed in with the invited email.</p> : null}</section></main>;
}
