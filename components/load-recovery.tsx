"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { LoadFailureKind } from "@/lib/club-load-state";

const copy: Record<LoadFailureKind, { title: string; message: string }> = {
  session: { title: "Your sign-in is still syncing", message: "Club couldn’t verify your session yet. Try again in a moment, or sign in again if this keeps happening." },
  permission: { title: "Access needs attention", message: "Club couldn’t confirm your current access. Ask an organisation manager to check your role." },
  network: { title: "Connection interrupted", message: "The service couldn’t be reached. Your information wasn’t changed." },
  unavailable: { title: "Temporarily unavailable", message: "This information couldn’t be loaded. Your information wasn’t changed." },
};

export function LoadRecovery({ app, kind, signInHref, reset }: { app: string; kind: LoadFailureKind; signInHref?: string; reset?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const content = copy[kind];
  return <section className="load-recovery" role="alert" aria-live="assertive" aria-busy={pending}>
    <span className="eyebrow">{app.toUpperCase()}</span>
    <h2>{content.title}</h2>
    <p>{content.message}</p>
    <div className="load-recovery-actions">
      {kind !== "permission" ? <button type="button" className="secondary" disabled={pending} onClick={() => startTransition(() => reset ? reset() : router.refresh())}>{pending ? "Retrying…" : "Try again"}</button> : null}
      {kind === "session" && signInHref ? <a className="load-recovery-link" href={signInHref}>Sign in again</a> : null}
    </div>
  </section>;
}
