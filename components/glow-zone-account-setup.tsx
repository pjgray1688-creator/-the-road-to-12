"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureGlowZoneCustomerAction } from "@/app/glow-zone/actions";

export function GlowZoneAccountSetup() {
  const started = useRef(false);
  const [state, setState] = useState<"working" | "failed">("working");
  const [error, setError] = useState("");
  const ensureCustomer = useCallback(async () => {
    setState("working"); setError("");
    try {
      const result = await ensureGlowZoneCustomerAction();
      if (!result.ok) { setError(result.error); setState("failed"); return; }
      // A document navigation lets the native shell move this WKWebView journey
      // to the Home tab instead of leaving Home content under Account.
      window.location.replace("/glow-zone");
    } catch {
      setError("We couldn’t connect your Glow Zone customer details just now. Please try again.");
      setState("failed");
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ensureCustomer();
  }, [ensureCustomer]);

  return <div className="glow-customer-bootstrap" aria-live="polite">
    <h2>{state === "working" ? "Getting Glow Zone ready" : "We couldn’t finish setting up Glow Zone"}</h2>
    {state === "working"
      ? <p className="muted">We’re securely connecting your verified R12 account. Existing minutes, loyalty and purchase history will be preserved.</p>
      : <><p role="alert">{error}</p><p className="muted">No membership, minutes, payment entitlement or age-verification status has been changed.</p><button className="primary" type="button" onClick={() => void ensureCustomer()}>Try again</button></>}
  </div>;
}
