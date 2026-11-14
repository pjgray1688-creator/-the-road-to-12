import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { MemberAccessPass, type MemberAccessPassData } from "@/components/member-access-pass";
import { MemberDemoNotice } from "@/components/member-demo-notice";
import { MemberAccessVenueEligibility } from "@/components/member-access-venue-eligibility";
import { serverSupabase } from "@/lib/supabase-server";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MembershipRow = { organisation?: { id?: string; name?: string; slug?: string } };

export default async function MemberGymAccessPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub%2Faccess");

  const params = await searchParams;
  if (hasPlayReviewerEntitlement(user)) return <AccessShell><MemberDemoNotice/><EmptyState title="Gym access is unavailable in review mode">Sign in with your member account to view a live access credential.</EmptyState></AccessShell>;

  const requestedOrg = params?.org;
  const membershipResult = await supabase.rpc("club_list_my_memberships");
  const { data: memberships, error: membershipError } = membershipResult;
  if (membershipError) return <AccessShell><EmptyState title="Access information is temporarily unavailable">Please try again. Your PIN and QR are not shown until R12 can confirm your account.</EmptyState></AccessShell>;

  const rows = Array.isArray(memberships) ? memberships as MembershipRow[] : [];
  const madhouse = rows.filter((row) => {
    const slug = row.organisation?.slug?.toLowerCase() ?? "";
    const name = row.organisation?.name?.toLowerCase() ?? "";
    return slug.includes("madhouse") || name.includes("madhouse");
  });
  const selected = requestedOrg ? madhouse.find((row) => row.organisation?.id === requestedOrg) : madhouse[0];
  const organisationId = selected?.organisation?.id;
  const organisationName = selected?.organisation?.name ?? "Madhouse Gym";
  if (!organisationId) return <AccessShell><EmptyState title="Madhouse membership not linked">Link your existing gym membership to this R12 account to view Gym Access.</EmptyState><Link className="member-hub-link" href="/member-hub/link"><strong>Link existing membership</strong></Link></AccessShell>;

  const passResult = await supabase.rpc("club_get_my_access_pass", { p_organisation_id: organisationId });
  const pass = !passResult.error && passResult.data && typeof passResult.data === "object"
    ? passResult.data as MemberAccessPassData
    : undefined;

  return <AccessShell>
    <PageHeader title="Gym Access" description={organisationName}/>
    {pass ? <MemberAccessPass pass={pass}/> : <Surface className="member-hub-section"><EmptyState title="Your access pass could not be loaded">Refresh to try again. R12 will not display an old or unverified PIN or QR.</EmptyState><Link className="member-hub-link" href={`/member-hub/access?org=${encodeURIComponent(organisationId)}`}><strong>Try again</strong></Link></Surface>}
    <Surface className="member-hub-section">
      <h2>24-hour access eligibility</h2>
      <Suspense fallback={<p role="status" className="muted">Checking venue eligibility…</p>}><MemberAccessVenueEligibility organisationId={organisationId}/></Suspense>
    </Surface>
    <Link className="member-hub-link" href="/member-hub"><strong>Back to Member Area</strong></Link>
  </AccessShell>;
}

function AccessShell({ children }: { children: ReactNode }) {
  return <AppShell className="module-page member-hub-page member-area-page member-access-page">{children}</AppShell>;
}
