import { redirect } from "next/navigation";
import Link from "next/link";
import { PrivacyDeletionQueue } from "@/components/privacy-deletion-queue";
import { privacyOperatorFromUser } from "@/lib/privacy-operator";
import { serverSupabase } from "@/lib/supabase-server";

export const metadata = { title: "Privacy request operations · R12" };

export default async function PrivacyRequestsPage() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Faccount%2Fprivacy-requests");
  if (!privacyOperatorFromUser(user)) return <main className="legal-page"><h1>Privacy operations</h1><p>This area is for authorised privacy operators.</p><Link href="/account">Back to account</Link></main>;
  return <main className="legal-page privacy-operations-page"><header><span className="brand-mark">R12</span><div><p className="eyebrow">RESTRICTED OPERATIONS</p><h1>Privacy requests</h1></div></header><PrivacyDeletionQueue /><p><Link href="/account">Back to account</Link></p></main>;
}
