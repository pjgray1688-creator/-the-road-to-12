"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authAccountHref } from "@/lib/auth-app";
import { redeemMadhouseMemberInvitationAction } from "@/app/club/members/activation/actions";

const TOKEN = /^[a-f0-9]{64}$/i;

export function MemberActivationClaim({ invitationId, signedIn, emailVerified }: { invitationId: string; signedIn: boolean; emailVerified: boolean }) {
  const [token, setToken] = useState<string>();
  const [status, setStatus] = useState<"ready" | "checking" | "linked" | "sign_in_required" | "email_verification_required" | "staff_verification_required" | "not_accepted">("ready");
  const started = useRef(false);
  const next = `/member-hub/activate?invitation=${encodeURIComponent(invitationId)}`;

  useEffect(() => {
    const key = `r12-member-activation:${invitationId}`;
    let found = "";
    try {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      found = fragment.get("token") ?? "";
      if (TOKEN.test(found)) window.sessionStorage.setItem(key, found);
      else found = window.sessionStorage.getItem(key) ?? "";
      if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    } catch {
      found = "";
    }
    if (TOKEN.test(found)) {
      const timer = window.setTimeout(() => setToken(found), 0);
      return () => window.clearTimeout(timer);
    }
  }, [invitationId]);

  useEffect(() => {
    if (!signedIn || !emailVerified || !token || started.current) return;
    started.current = true;
    setStatus("checking");
    void redeemMadhouseMemberInvitationAction({ invitationId, token }).then(result => {
      if (result.ok) {
        try { window.sessionStorage.removeItem(`r12-member-activation:${invitationId}`); } catch {}
        setStatus("linked");
      } else setStatus(result.state);
    }).catch(() => setStatus("not_accepted"));
  }, [emailVerified, invitationId, signedIn, token]);

  if (status === "linked") return <div role="status"><h2>Your existing membership is connected</h2><p>Your membership and its history have been retained. No payment was requested or taken.</p><Link className="primary" href="/member-hub">Open R12 Member</Link></div>;
  if (!signedIn) return <div><h2>Activate your existing membership</h2><p>Sign in or create an R12 account using the email address this invitation was sent to. R12 will verify that email before connecting your existing Madhouse membership.</p>
    <p><Link className="primary" href={authAccountHref("training", "signUp", next)}>Create an R12 account</Link></p>
    <p><Link className="secondary" href={authAccountHref("training", "signIn", next)}>I already have an R12 account</Link></p>
    {!token ? <p className="muted">Open this page from the invitation email on the same device and browser used to verify your R12 email.</p> : null}
  </div>;
  if (!emailVerified) return <div role="status"><h2>Verify your R12 email first</h2><p>Confirm the email address you used to create your R12 account, then reopen this invitation link. Your membership will not be linked until verification is complete.</p><Link className="secondary" href="/account/verify?app=training">Check verification</Link></div>;
  if (status === "checking") return <p role="status" aria-live="polite">Checking the invitation and connecting your existing membership…</p>;
  if (status === "staff_verification_required") return <div role="alert"><h2>Madhouse staff need to verify your details</h2><p>We could not safely connect this invitation to one unambiguous member record. Your existing membership has not been changed. Please contact Madhouse staff.</p></div>;
  if (status === "not_accepted") return <div role="alert"><h2>This invitation could not be accepted</h2><p>It may have expired, already been used by another account, or belong to a different verified email. Reopen the original invitation or contact Madhouse staff.</p></div>;
  if (status === "sign_in_required") return <p role="status">Sign in to continue.</p>;
  if (status === "email_verification_required") return <p role="status">Verify the email on your R12 account before continuing.</p>;
  return <div><h2>Secure membership activation</h2><p>The invitation token stays in this browser session and is removed from the address bar. Your verified email must match the invited address exactly.</p>{token ? <p role="status">Invitation link ready. Checking will begin after sign-in and email verification.</p> : <p role="alert">Open the link from the invitation email to continue.</p>}</div>;
}
