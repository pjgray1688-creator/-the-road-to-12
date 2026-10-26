import Link from "next/link";
import { redirect } from "next/navigation";
import { claimStaffAccessGrant } from "@/app/club/staff/actions";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { staffClaimReturnTo } from "@/lib/auth-return";
import { serverSupabase } from "@/lib/supabase-server";

type ClaimContext = {
  grant_id: string;
  organisation_id: string;
  organisation_name: string;
  display_name: string | null;
  intended_role: string;
  venue_names: string[];
  coach_requested: boolean;
  grant_status: string;
  expires_at: string;
};

function roleLabel(role: string) {
  return role === "owner" ? "Owner" : role === "gym_admin" ? "Manager" : role === "trainer" ? "PT / Coach" : "Operational Staff";
}

function venueLabel(names: string[]) {
  return names.length ? names.join(" + ") : "No venue-specific access assigned";
}

function AccessSummary({ context }: { context: ClaimContext }) {
  return <dl className="staff-claim-summary">
    <div><dt>Role</dt><dd>{roleLabel(context.intended_role)}</dd></div>
    <div><dt>Venues</dt><dd>{venueLabel(context.venue_names)}</dd></div>
    {context.coach_requested ? <div><dt>Coach/PT</dt><dd>Enabled</dd></div> : null}
  </dl>;
}

export default async function StaffClaimPage({ searchParams }: { searchParams: Promise<{ grant?: string }> }) {
  const params = await searchParams;
  const grantId = params.grant && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.grant) ? params.grant : undefined;
  const returnTo = staffClaimReturnTo(grantId);
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect(`/account?app=club&mode=signIn&next=${encodeURIComponent(returnTo)}`);

  if (grantId) {
    const { data } = await client.rpc("club_get_my_staff_claim_context", { p_grant_id: grantId });
    const context = (Array.isArray(data) ? data[0] : data) as ClaimContext | null;
    if (context?.grant_status === "accepted") return <AppShell className="module-page club-page staff-claim-page">
      <PageHeader eyebrow="R12 × MADHOUSE" title="You’re in." description="Your R12 staff access is active." />
      <Surface><h2>Staff access active</h2><p className="muted">{context.organisation_name}</p><AccessSummary context={context} />
        <div className="staff-claim-actions"><Link className="primary" href={`/club?org=${encodeURIComponent(context.organisation_id)}`}>Open Club</Link>{context.coach_requested ? <Link className="secondary" href="/coach">Open Coach</Link> : null}<Link className="text-button" href="/member-hub">Go to R12 home</Link></div>
      </Surface><AppNav />
    </AppShell>;

    if (context?.grant_status === "pending") return <AppShell className="module-page club-page staff-claim-page">
      <PageHeader eyebrow="WELCOME TO R12 × MADHOUSE" title="Staff access waiting" description={`Your ${context.organisation_name} access is ready to activate.`} />
      <Surface><AccessSummary context={context} />
        <p className="muted">Signed in as {user.email ?? "your R12 account"}. Accept using the verified email address the invitation was sent to.</p>
        <p className="muted">Invitation expires {new Date(context.expires_at).toLocaleDateString("en-GB")}.</p>
        {user.email_confirmed_at ? <form action={async () => {
          "use server";
          const result = await claimStaffAccessGrant(grantId);
          if (result.ok) redirect(`/club/staff/claim?grant=${encodeURIComponent(grantId)}`);
        }}><button className="primary" type="submit">Accept staff access</button></form> : <p role="status">Verify this email address before accepting staff access. Open the verification email and then return to this invitation.</p>}
      </Surface><AppNav />
    </AppShell>;

    return <AppShell className="module-page club-page staff-claim-page">
      <PageHeader eyebrow="R12 × MADHOUSE" title="Invitation unavailable" description="This invitation may have expired, already been used, or may have been sent to a different email address." />
      <Surface><p className="muted">Sign in with the verified email address the invitation was sent to. If you are already signed in with another address, sign out and try again.</p><Link className="secondary" href="/account">Account and sign-out options</Link></Surface><AppNav />
    </AppShell>;
  }

  const { data } = await client.rpc("club_list_my_pending_staff_access");
  const grants = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const contexts = await Promise.all(grants.map(async grant => {
    const { data: contextData } = await client.rpc("club_get_my_staff_claim_context", { p_grant_id: String(grant.id) });
    return (Array.isArray(contextData) ? contextData[0] : contextData) as ClaimContext | null;
  }));
  const available = contexts.filter((context): context is ClaimContext => context?.grant_status === "pending");
  return <AppShell className="module-page club-page staff-claim-page">
    <PageHeader eyebrow="R12 × MADHOUSE" title="Staff access" description="Accept access using your own verified R12 account." />
    {available.length ? available.map(context => <Surface key={context.grant_id}><h2>{context.organisation_name}</h2><AccessSummary context={context} /><p className="muted">Invitation expires {new Date(context.expires_at).toLocaleDateString("en-GB")}.</p><Link className="primary" href={`/club/staff/claim?grant=${encodeURIComponent(context.grant_id)}`}>Review staff access</Link></Surface>) : <EmptyState title="No pending Club access">Ask a Club manager to prepare access for {user.email ?? "this account"}, or sign in with the invited email.</EmptyState>}
    <AppNav />
  </AppShell>;
}
