import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubMemberClaim } from "@/components/club-member-claim";
import { serverSupabase } from "@/lib/supabase-server";

export default async function LinkMembershipPage() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub%2Flink");
  const { data } = await supabase.rpc("club_list_joinable_organisations");
  const organisations = Array.isArray(data) ? data as Array<{ id: string; name: string }> : [];
  const claims = await Promise.all(organisations.map(async organisation => ({ organisation, claim: (await supabase.rpc("club_preview_existing_member_claim", { p_organisation_id: organisation.id })).data as { state: string; customer_id?: string; display_name?: string; email?: string; memberships?: Array<{ id: string; name: string; status: string }> } | null })));
  return <AppShell className="module-page"><PageHeader eyebrow="MEMBER AREA" title="I’m already a member" description="Connect your existing gym membership to your verified personal R12 account." />{claims.length ? claims.map(({ organisation, claim }) => <Surface key={organisation.id}><h2>{organisation.name}</h2><ClubMemberClaim organisationId={organisation.id} claim={claim ?? { state: "staff_help_required" }} /></Surface>) : <Surface><EmptyState title="No gym is available">Ask Madhouse staff for the current account activation link.</EmptyState></Surface>}<Surface><h2>Need help?</h2><p className="muted">If the gym has an old or missing email, staff must verify your identity before linking. They cannot see or set your password.</p><Link className="secondary" href="/account">Password and account help</Link></Surface></AppShell>;
}
