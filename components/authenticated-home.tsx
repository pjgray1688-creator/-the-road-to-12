"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
import { browserSupabase } from "@/lib/supabase-browser";
import { HomeShell } from "./home-shell";

type AuthState = "loading" | "signed_out" | "signed_in";

export function AuthenticatedHome() {
  const [state, setState] = useState<AuthState>("loading");
  useEffect(() => {
    const supabase = browserSupabase();
    void supabase.auth.getSession().then(({ data }) => setState(data.session ? "signed_in" : "signed_out"));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setState(session ? "signed_in" : "signed_out"));
    return () => listener.subscription.unsubscribe();
  }, []);
  if (state === "loading") return <main className="shell auth-splash" aria-busy="true"><BrandLockup /><span className="loading-indicator" aria-label="Loading" /></main>;
  if (state === "signed_out") return <main className="shell auth-welcome"><BrandLockup /><p className="landing-kicker">YOUR TRAINING, YOUR WAY</p><h1>Your training.<br />Your <em>recovery.</em></h1><p>One intelligent system to train, recover and track progress — built around you.</p><div className="welcome-glimpse" aria-label="App capabilities"><span>Adaptive training</span><span>Readiness</span><span>Progress</span></div><div className="auth-welcome-actions"><Link className="primary big" href="/account?mode=signUp">Get started <span>→</span></Link><Link className="secondary big" href="/account?mode=signIn">Sign in</Link></div><p className="landing-note">Private by design · built for the long run</p></main>;
  return <HomeShell />;
}
