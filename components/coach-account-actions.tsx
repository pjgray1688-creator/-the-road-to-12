"use client";

import { useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export function CoachAccountActions() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await browserSupabase().auth.signOut({ scope: "local" });
    if (error) {
      setBusy(false);
      setMessage("You couldn’t be signed out just now. Please try again.");
      return;
    }
    window.location.assign("/account?mode=signIn");
  };

  return <div className="coach-account-actions"><button type="button" className="secondary" onClick={() => void signOut()} disabled={busy}>{busy ? "Signing out…" : "Sign out of this device"}</button>{message ? <p role="status">{message}</p> : null}</div>;
}
