import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { claimStaffAccessGrant } from "@/app/club/staff/actions";

const roleLabel = (role: string) => role === "gym_admin" ? "Manager" : role === "trainer" ? "PT" : "Operational Staff";

export default async function StaffClaimPage() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Fstaff%2Fclaim");
  const { data: grants } = await client.rpc("club_list_my_pending_staff_access");

  return <AppShell className="module-page club-page">
    <PageHeader eyebrow="R12 CLUB · ACCESS" title="Staff access" description="Accept access using your own R12 account. Your password remains private to you." />
    {Array.isArray(grants) && grants.length ? <Surface>{grants.map(grant => {
      const organisationId = String(grant.organisation_id);
      return <form key={String(grant.id)} action={async () => {
        "use server";
        const result = await claimStaffAccessGrant(String(grant.id));
        if (result.ok) redirect(`/club?org=${encodeURIComponent(organisationId)}`);
      }}>
        <strong>Accept {String(grant.organisation_name)} staff access</strong>
        <p className="muted">{String(grant.display_name ?? "Staff member")} · {roleLabel(String(grant.intended_role))}</p>
        <p className="muted">Coach/PT: {grant.coach_requested ? "Will be enabled" : "Not enabled"} · Gym member: {grant.member_intent ? "Recorded as expected — membership still needs adding separately" : "No membership expected"}</p>
        <p className="muted">Expires {new Date(String(grant.expires_at)).toLocaleDateString("en-GB")}.</p>
        <button className="primary" type="submit">Accept staff access</button>
      </form>;
    })}</Surface> : <EmptyState title="No pending Club access">Ask a Club manager to prepare access for {user.email ?? "this account"}, or sign in with the invited email.</EmptyState>}
    <AppNav />
  </AppShell>;
}
