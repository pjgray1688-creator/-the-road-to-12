"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
import { browserSupabase } from "@/lib/supabase-browser";
import { HomeShell } from "./home-shell";
import { setStorageUserId } from "@/lib/storage";

type AuthState = "loading" | "signed_out" | "error";

export function AuthenticatedHome() {
  const [state, setState] = useState<AuthState>("loading"); const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = browserSupabase();
    let alive = true;
    let settled = false;
    let timeout: number | undefined;
    const finish = (id: string | null) => {
      if (!alive) return;
      settled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      setStorageUserId(id); setUserId(id); setState(id ? "loading" : "signed_out");
    };
    timeout = window.setTimeout(() => { if (alive && !settled) setState("error"); }, 12_000);
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => finish(session?.user.id ?? null));
    void supabase.auth.getSession().then(({ data }) => { if (!settled) finish(data.session?.user.id ?? null); }).catch(() => {
      if (alive && !settled) { settled = true; if (timeout !== undefined) window.clearTimeout(timeout); setState("error"); }
    });
    return () => { alive = false; if (timeout !== undefined) window.clearTimeout(timeout); listener.subscription.unsubscribe(); };
  }, []);
  if (state === "loading") return <main className="shell auth-splash" aria-busy="true"><BrandLockup /><span className="loading-indicator" aria-label="Loading" /></main>;
  if (state === "error") return <main className="shell auth-welcome"><BrandLockup /><h1>We couldn&apos;t restore your session.</h1><p>Try again, or open your account to sign in.</p><button className="primary" onClick={() => window.location.reload()}>Try again</button><Link className="secondary" href="/account?mode=signIn">Open account</Link></main>;
  if (state === "signed_out") return <main className="shell auth-welcome"><BrandLockup /><p className="landing-kicker">YOUR TRAINING, YOUR WAY</p><h1>Your training.<br />Your <em>recovery.</em></h1><p>One intelligent system to train, recover and track progress — built around you.</p><div className="welcome-glimpse" aria-label="App capabilities"><span>Adaptive training</span><span>Readiness</span><span>Progress</span></div><div className="auth-welcome-actions"><Link className="primary big" href="/account?mode=signUp">Get started <span>→</span></Link><Link className="secondary big" href="/account?mode=signIn">Sign in</Link></div><p className="landing-note">Private by design · built for the long run</p></main>;
  return userId ? <HomeShell key={userId} userId={userId} /> : <main className="shell auth-splash" aria-busy="true"><BrandLockup /><span className="loading-indicator" aria-label="Loading" /></main>;
}
