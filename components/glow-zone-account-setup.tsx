"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ensureGlowZoneCustomerAction } from "@/app/glow-zone/actions";

export function GlowZoneAccountSetup() {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState("");
  return <><h2>Finish setting up Glow Zone</h2><p className="muted">We’ll first look for one existing Glow Zone customer record with your verified email. If there is a unique match, we’ll securely connect it and preserve its minutes and activity.</p><p className="muted">If you’re new to Glow Zone, we’ll create a customer profile for this account. This does not create a Madhouse gym membership, change a membership, or enable gym-door access.</p><button className="primary" type="button" disabled={pending} onClick={() => startTransition(async () => { setError(""); const result = await ensureGlowZoneCustomerAction(); if (result.ok) { router.replace("/glow-zone"); router.refresh(); } else setError(result.error); })}>{pending ? "Checking your details…" : "Set up Glow Zone"}</button>{error ? <p role="alert">{error}</p> : null}</>;
}
