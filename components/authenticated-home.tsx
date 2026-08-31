"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
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
  if (state === "loading") return <main className="shell auth-splash" aria-busy="true"><span className="brand-mark">T/12</span><p className="eyebrow">THE ROAD TO 12%</p></main>;
  if (state === "signed_out") return <main className="shell auth-welcome"><span className="brand-mark">T/12</span><p className="eyebrow">THE ROAD TO 12%</p><h1>Training, nutrition and recovery — built around you.</h1><p>One place to train, eat, recover and track progress with your Coach.</p><div className="auth-welcome-actions"><Link className="primary big" href="/account">Get started</Link><Link className="secondary big" href="/account">Sign in</Link></div></main>;
  return <HomeShell />;
}
