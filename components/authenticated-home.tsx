"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
import { brand } from "@/lib/brand";
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
  if (state === "loading") return <main className="shell auth-splash" aria-busy="true"><BrandLockup /><p className="eyebrow">{brand.name}</p></main>;
  if (state === "signed_out") return <main className="shell auth-welcome"><BrandLockup /><p className="eyebrow">{brand.name}</p><h1>Training, nutrition and recovery — built around you.</h1><p>One place to train, eat, recover and track progress with your Coach.</p><div className="welcome-glimpse" aria-label="App capabilities"><span>Adaptive training</span><span>Readiness</span><span>Progress</span></div><div className="auth-welcome-actions"><Link className="primary big" href="/account">Get started</Link><Link className="secondary big" href="/account">Sign in</Link></div></main>;
  return <HomeShell />;
}
