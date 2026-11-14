"use client";

import { AppNav } from "@/components/app-nav";
import { BrandLockup } from "@/components/brand-lockup";

export function MemberStartupShell({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <main className="shell home-screen member-startup-shell" aria-busy={!onRetry}>
    <header className="member-startup-brand"><BrandLockup compact /><span className="eyebrow">R12 MEMBER</span></header>
    <section className="card dashboard member-startup-status">
      <div><strong>{message}</strong>{onRetry ? <p>Your account and training data are still protected. Try loading again.</p> : null}</div>
      {onRetry ? <button className="secondary" type="button" onClick={onRetry}>Try again</button> : <span className="loading-indicator" role="status" aria-label="Loading" />}
    </section>
    <AppNav />
  </main>;
}
