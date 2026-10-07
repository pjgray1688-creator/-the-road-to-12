"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function CoachReferralClaim({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "signedOut" | "ready" | "done" | "error">("loading");
  const [message, setMessage] = useState("");
  useEffect(() => {
    void fetch(`/api/coach/referrals/${encodeURIComponent(token)}`, { method: "POST" }).then(async response => {
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) { setState("signedOut"); setMessage(result.error); return; }
      if (!response.ok) { setState("error"); setMessage(result.error ?? "This coaching invitation is no longer available."); return; }
      setState("done"); setMessage("You’re connected. Your Coach can now work with you in R12.");
    }).catch(() => { setState("error"); setMessage("This coaching invitation could not be checked."); });
  }, [token]);
  const returnTo = `/coach/join/${encodeURIComponent(token)}`;
  return <main className="shell"><section className="card"><span className="eyebrow">R12 COACH</span><h1>Join your Coach on R12</h1>{state === "loading" ? <p>Checking your invitation…</p> : state === "signedOut" ? <><p>{message}</p><div className="coach-actions"><Link className="primary" href={`/account?mode=signIn&next=${encodeURIComponent(returnTo)}`}>Sign in</Link><Link className="secondary" href={`/account?mode=signUp&next=${encodeURIComponent(returnTo)}`}>Create account</Link></div></> : <p role={state === "error" ? "alert" : "status"}>{message}</p>}{state === "done" ? <p><Link href="/coach">Open Coach</Link></p> : null}</section></main>;
}
