"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { browserSupabase } from "@/lib/supabase-browser";
import { AppNav } from "@/components/app-nav";
import { AppShell, NavigationRow, PageHeader, Surface } from "@/components/ui";
import { BrandLockup } from "@/components/brand-lockup";
import { AuthBrand } from "@/components/auth-brand";
import { GlowZoneNav } from "@/components/glow-zone-nav";
import { authCallbackUrl, authDestination } from "@/lib/auth-return";
import { authAccountHref, authApps, type AuthApp } from "@/lib/auth-app";
import { isStaleAuthSessionError, signInErrorMessage } from "@/lib/auth-sign-in-errors";

type Account = { id: string; email?: string; profile?: { first_name?: string; last_name?: string; display_name?: string } };
type AuthMode = "signIn" | "signUp" | "forgot";

export default function AccountPage() {
  const router = useRouter(); const [supabase, setSupabase] = useState<ReturnType<typeof browserSupabase> | null>(null); const [account, setAccount] = useState<Account | null>(null); const [contextReady, setContextReady] = useState(false); const [loading, setLoading] = useState(true); const [message, setMessage] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [authMode, setAuthMode] = useState<AuthMode>("signIn"); const [authApp, setAuthApp] = useState<AuthApp>("training"); const [editing, setEditing] = useState(false); const [whoop, setWhoop] = useState<{ connected?: boolean; lastSyncAt?: string }>({}); const [ageStatus, setAgeStatus] = useState<"verified" | "under_18" | "required" | "unavailable">("required");
  const refresh = async () => { if (!supabase) return; const { data: { user }, error } = await supabase.auth.getUser(); if (!user) { if (isStaleAuthSessionError(error)) { await supabase.auth.signOut({ scope: "local" }); setMessage(signInErrorMessage(error)); } setAccount(null); setLoading(false); return; } const params = new URLSearchParams(window.location.search); const context = authDestination({ app: params.get("app"), privacyApp: params.get("privacyApp"), next: params.get("next") }); const glowAccount = context.app === "glow"; if (params.get("next") && !glowAccount) { window.location.replace(context.next); return; } const profileResponse = await fetch("/api/account"); const profile = profileResponse.ok ? await profileResponse.json() : undefined; setAccount({ id: user.id, email: user.email, profile: profile?.profile }); setFirstName(profile?.profile?.first_name ?? ""); setLastName(profile?.profile?.last_name ?? ""); if (glowAccount) { const glow = await fetch("/api/glow-zone/account").then(response => response.json()).catch(() => ({ ageStatus: "unavailable" })); setAgeStatus(glow.ageStatus ?? "unavailable"); } else setWhoop(await fetch("/api/integrations/whoop/status").then(response => response.ok ? response.json() : {}).catch(() => ({}))); setLoading(false); };
  // Auth client initialization and subscription intentionally update state from an external session source.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { setSupabase(browserSupabase()); const params = new URLSearchParams(window.location.search); const mode = params.get("mode"); const context = authDestination({ app: params.get("app"), privacyApp: params.get("privacyApp"), next: params.get("next") }, mode === "signUp"); setAuthApp(context.app); if (mode === "signUp" || mode === "signIn" || mode === "forgot") setAuthMode(mode); const verification = params.get("verification"); if (verification === "expired") setMessage("This verification link is invalid or has expired. Request a fresh email or sign in if you already verified."); else if (verification === "invalid") setMessage("This verification link is incomplete. Request a fresh email or sign in if you already verified."); setContextReady(true); }, []); useEffect(() => { if (!supabase) return; void refresh(); const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) void refresh(); else { setAccount(null); setLoading(false); } }); return () => listener.subscription.unsubscribe(); }, [supabase]);
  const submit = async () => { if (!supabase) return; setMessage(""); const params = new URLSearchParams(window.location.search); const context = authDestination({ app: params.get("app"), privacyApp: params.get("privacyApp"), next: params.get("next") }, authMode === "signUp"); const appBaseUrl = window.location.origin; if (authMode === "forgot") { const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appBaseUrl}/account/reset?app=${context.app}` }); setMessage(result.error ? "We couldn't send reset instructions. Please try again." : "If an account exists for that email, we've sent password reset instructions."); return; } if (authMode === "signIn") { const { data: current } = await supabase.auth.getSession(); if (current.session) { const validation = await supabase.auth.getUser(); if (isStaleAuthSessionError(validation.error)) await supabase.auth.signOut({ scope: "local" }); } } const result = authMode === "signIn" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { data: { first_name: firstName.trim(), last_name: lastName.trim(), display_name: [firstName, lastName].filter(Boolean).join(" "), origin_app: context.app, auth_return_to: context.next }, emailRedirectTo: authCallbackUrl(appBaseUrl, context.next, context.app) } }); if (result.error) { if (authMode === "signIn" && isStaleAuthSessionError(result.error)) await supabase.auth.signOut({ scope: "local" }); setMessage(authMode === "signIn" ? signInErrorMessage(result.error) : "We couldn't create your account. Check your details and try again."); } else if (authMode === "signUp") { if (result.data.session) window.location.replace(context.next); else { try { window.sessionStorage.setItem("r12.pending-auth-email", email.trim()); } catch {} router.replace(`/account/verify?app=${context.app}&next=${encodeURIComponent(context.next)}`); } } else window.location.replace(context.next); };
  const saveProfile = async () => { const response = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first_name: firstName, last_name: lastName }) }); if (!response.ok) { setMessage("We couldn't update your details. Please try again."); return; } setEditing(false); await refresh(); setMessage("Profile updated."); };
  const disconnectWhoop = async () => { const response = await fetch("/api/integrations/whoop/disconnect", { method: "POST" }); if (!response.ok) { setMessage("We couldn't disconnect WHOOP. Please try again."); return; } setWhoop({ connected: false }); setMessage("WHOOP disconnected."); };
  const isGlowAccount = authApp === "glow";
  if (!contextReady) return <main className="shell auth-splash" aria-busy="true"><p>Preparing secure sign-in…</p></main>;
  if (loading) return <main className={`shell auth-splash${isGlowAccount ? " glow-auth-splash" : ""}`} aria-busy="true">{isGlowAccount ? <><Image src="/r12-app-assets/glow-zone-brand.png" width="72" height="72" alt="Glow Zone" priority /><p>Loading Glow Zone…</p></> : <><BrandLockup /><p>Resolving your session…</p></>}</main>;
  if (!account) { const next = typeof window === "undefined" ? authApps[authApp].defaultReturnTo : authDestination({ app: authApp, next: new URLSearchParams(window.location.search).get("next") }, authMode === "signUp").next; const signInHref = authAccountHref(authApp, "signIn", next); return <main className={`legal-page account-page auth-page auth-product-page auth-product-page-${authApp}${isGlowAccount ? " glow-auth" : ""}`}><AuthBrand app={authApp} /><header><div><p className="eyebrow">{authApps[authApp].eyebrow}</p><h1>{authMode === "forgot" ? "Reset password" : authMode === "signUp" ? `Create your ${authApps[authApp].name} account` : `Sign in to ${authApps[authApp].name}`}</h1></div></header><p>{authMode === "signUp" ? `Create your shared R12 account and continue in ${authApps[authApp].name}.` : authMode === "forgot" ? "Enter your email and we’ll send secure reset instructions." : `Use your shared R12 email and password to continue in ${authApps[authApp].name}.`}</p>{authMode === "signUp" && <><label>First name<input autoComplete="given-name" value={firstName} onChange={event => setFirstName(event.target.value)} /></label><label>Last name<input autoComplete="family-name" value={lastName} onChange={event => setLastName(event.target.value)} /></label></>}<label>Email<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label>{authMode !== "forgot" && <label>Password<input type="password" autoComplete={authMode === "signUp" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>}<button className="primary" onClick={() => void submit()}>{authMode === "signIn" ? "Sign in" : authMode === "signUp" ? "Create account" : "Send reset email"}</button>{authMode === "signIn" && <button className="text-button" onClick={() => setAuthMode("forgot")}>Forgot password?</button>}<button className="text-button" onClick={() => setAuthMode(authMode === "signUp" ? "signIn" : "signUp")}>{authMode === "signUp" ? "I already have an account" : "Create account"}</button>{authMode === "forgot" && <button className="text-button" onClick={() => setAuthMode("signIn")}>Back to sign in</button>}{message && <p role="status">{message}{authMode === "signUp" && <><br /><Link href={signInHref}>Continue to sign in</Link></>}</p>}{isGlowAccount && <p className="glow-auth-powered">Your existing R12 account works here. Creating an account does not create or change a gym membership.</p>}<p><Link href={authApps[authApp].defaultReturnTo}>‹ Back to {authApps[authApp].name}</Link></p></main>; }
  if (isGlowAccount && account) {
    return <main className="legal-page account-page glow-auth glow-account-standalone">
      <div className="glow-auth-brand">
        <Image src="/r12-app-assets/glow-zone-brand.png" width="76" height="76" alt="Glow Zone" />
      </div>
      <h1>My account</h1>
      <section className="glow-account-section">
        <span className="eyebrow">PERSONAL DETAILS</span>
        <p><strong>Email</strong></p>
        <p>{account.email}</p>
        <p><strong>Name</strong></p>
        <p>{[account.profile?.first_name, account.profile?.last_name].filter(Boolean).join(" ") || "Not provided"}</p>
      </section>
      <section className="glow-account-section">
        <span className="eyebrow">AGE VERIFICATION</span>
        <p className={`glow-age-state glow-age-${ageStatus}`}>{ageStatus === "verified" ? "Verified — 18 or over" : ageStatus === "under_18" ? "Not eligible for sunbed use" : ageStatus === "unavailable" ? "Status temporarily unavailable" : "Verification required at reception"}</p>
        <p className="muted">Sunbed use is restricted to customers aged 18 or over. Staff verify eligibility before approving a session.</p>
      </section>
      <section className="glow-account-section glow-account-links">
        <Link href="/glow-zone/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/account/delete?app=glow">Delete your R12 account</Link>
      </section>
      <button className="secondary account-signout" type="button"
        onClick={() => void supabase?.auth.signOut().then(() => {
          setAccount(null);
          router.replace("/account?app=glow&mode=signIn&next=%2Fglow-zone");
        })}>Sign out</button>
      <GlowZoneNav current="account" />
    </main>;
  }
  const fullName = [account.profile?.first_name, account.profile?.last_name].filter(Boolean).join(" ") || account.profile?.display_name || "Your account";
  return <AppShell className="module-page account-page"><PageHeader eyebrow="ACCOUNT" title={fullName} />
    <Surface><span className="eyebrow">PROFILE</span><NavigationRow label="Personal details" detail={account.email ?? "Account email"} onClick={() => setEditing(value => !value)}><b>›</b></NavigationRow>{editing && <div className="inline-form"><label>First name<input value={firstName} onChange={event => setFirstName(event.target.value)} /></label><label>Last name<input value={lastName} onChange={event => setLastName(event.target.value)} /></label><button className="primary" onClick={() => void saveProfile()}>Save details</button></div>}</Surface>
    <Surface><span className="eyebrow">MY GYM</span><NavigationRow href="/member-hub" label="My Gym" detail="Your membership, classes, balance and shop" /></Surface>
    <Surface><span className="eyebrow">TRAINING</span><NavigationRow href="/onboarding" label="Training setup" detail="Create, build, or change your programme choice" /></Surface>
    <Surface><span className="eyebrow">CONNECTIONS</span><div className="settings-row"><span>WHOOP<small>{whoop.connected ? `Connected${whoop.lastSyncAt ? ` · Last synced ${new Date(whoop.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}` : "Not connected"}</small></span>{whoop.connected ? <button className="text-button" type="button" onClick={() => void disconnectWhoop()}>Disconnect</button> : <b aria-hidden="true">›</b>}</div><div className="settings-row"><span>Apple Health<small>Not connected</small></span></div></Surface>
    <Surface><span className="eyebrow">HELP &amp; SUPPORT</span><NavigationRow href="/tutorial/member" label="Replay Member tutorial" detail="Today, workouts, RIR and progress" /><NavigationRow href="/tutorial/coach" label="Replay Coach tutorial" detail="Available to authorised Coaches" /><NavigationRow href={authApps[authApp].privacyPath} label="Privacy" /><NavigationRow href="/terms" label="Terms" /><NavigationRow href={`/account/delete?app=${authApp}`} label="Delete your R12 account" detail="Request account and personal-data deletion" /></Surface>
    {message && <p role="status">{message}</p>}<button className="secondary account-signout" onClick={() => void supabase?.auth.signOut()}>Sign out</button><AppNav />
  </AppShell>;
}
