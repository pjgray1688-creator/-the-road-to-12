"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandLockup } from "@/components/brand-lockup";
import { browserSupabase } from "@/lib/supabase-browser";
import { safeInternalReturnTo } from "@/lib/auth-return";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Verifying your email securely…");

  useEffect(() => {
    const next = safeInternalReturnTo(new URLSearchParams(window.location.search).get("next")) ?? "/member-hub";
    const supabase = browserSupabase();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { window.sessionStorage.removeItem("r12.pending-auth-email"); } catch {}
      router.replace(next);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) finish(); });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (data.session?.user) finish();
      else setMessage(error ? "This verification link is invalid or has expired." : "We couldn’t verify this session. Please sign in with the email you verified.");
    });
    return () => listener.subscription.unsubscribe();
  }, [router]);

  return <main className="legal-page account-page auth-page verification-page"><BrandLockup /><p className="verification-brand">R12 × MADHOUSE</p><p className="eyebrow">ACCOUNT SECURITY</p><h1>One moment</h1><p className="verification-copy" role="status">{message}</p><Link className="verification-back" href="/account?mode=signIn">Continue to sign in</Link></main>;
}
