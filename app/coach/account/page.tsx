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
    <h1 className="coach-visually-hidden">Account</h1>
    <section className={styles.card} aria-labelledby="coach-identity-title"><div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{displayName.split(/\s+/).map((part: string) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><h2 id="coach-identity-title">{displayName}</h2><p>{user.email ?? "Email not available"}</p></div></div><div className={styles.access}><span>Coach access</span><strong role="status">{coachError ? "Status unavailable" : coachAccess ? "Enabled" : "Not enabled"}</strong></div></section>
    <section className={styles.card} aria-label="Products and session">{memberEligible ? <div className={styles.productSwitch}><div><span className="eyebrow">R12 MEMBER</span><p>Switch to your member space.</p></div><Link className={styles.quietButton} href="/member-hub">Open R12</Link></div> : null}<div className={styles.signOut}><span className="eyebrow">SESSION</span><CoachAccountActions /><Link className={styles.quietButton} href="/coach/privacy">Privacy policy</Link><Link className={styles.quietButton} href="/account/delete">Delete R12 account</Link></div></section>
  </main>;
}
