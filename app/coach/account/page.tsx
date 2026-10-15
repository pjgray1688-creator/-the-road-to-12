import Link from "next/link";
import { redirect } from "next/navigation";
import { CoachAccountActions } from "@/components/coach-account-actions";
import { serverSupabase } from "@/lib/supabase-server";
import styles from "./page.module.css";

export default async function CoachAccountPage() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fcoach%2Faccount");

  const [{ data: coachAccess, error: coachError }, { data: memberships, error: memberError }] = await Promise.all([
    supabase.rpc("coach_has_access", { p_client_user_id: null }),
    supabase.rpc("club_list_my_memberships"),
  ]);
  const displayName = [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ") || user.user_metadata?.display_name || "R12 account";
  const memberEligible = !memberError && Array.isArray(memberships) && memberships.length > 0;

  return <main className={styles.page}>
    <header><span className="eyebrow">R12 COACH · ACCOUNT</span><h1>Account &amp; settings</h1><p>Your Coach access uses your existing R12 account.</p></header>
    <section className={styles.card} aria-labelledby="coach-identity-title"><span className="eyebrow">SIGNED-IN IDENTITY</span><h2 id="coach-identity-title">{displayName}</h2><p>{user.email ?? "Email not available"}</p></section>
    <section className={styles.card} aria-labelledby="coach-access-title"><span className="eyebrow">ACCESS</span><h2 id="coach-access-title">Coach access</h2><p role="status">{coachError ? "Access status couldn’t be checked." : coachAccess ? "Enabled" : "Not enabled for this account."}</p></section>
    {memberEligible ? <section className={styles.card}><span className="eyebrow">PRODUCT SWITCHER</span><h2>R12 Member</h2><p>Your existing member access is available with this account.</p><Link className="primary" href="/member-hub">Open R12</Link></section> : null}
    <section className={styles.card}><span className="eyebrow">SESSION</span><p>Sign out here to end this session on this device.</p><CoachAccountActions /></section>
  </main>;
}
