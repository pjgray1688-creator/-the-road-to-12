import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { MemberHub, type MemberHubData } from "@/components/member-hub";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { reviewerMemberHubData } from "@/lib/play-reviewer-member-data";
import { autoLinkVerifiedMadhouseMember } from "@/lib/madhouse-auto-link";
import { classifyLoadFailure, safeLoadFailureFields, type LoadFailureKind } from "@/lib/club-load-state";
import { uniqueMembershipOrganisationRows } from "@/lib/member-hub-view";

export default async function MemberHubPage() {
  const { client: supabase, user, error: authError } = await getServerUser();
  if (!user && authError && classifyLoadFailure(authError) !== "unavailable") return <MemberHub data={[]} loadIssue={classifyLoadFailure(authError)}/>;
  if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub");
  if (hasPlayReviewerEntitlement(user)) return <MemberHub data={reviewerMemberHubData()} demoMode />;
  await autoLinkVerifiedMadhouseMember(supabase, undefined, user);
  const { data, error } = await supabase.rpc("club_list_my_memberships");
  if (error) {
    const kind = classifyLoadFailure(error);
    console.error("[member-hub] memberships load failed", safeLoadFailureFields(error));
    return <MemberHub data={[]} loadIssue={kind}/>;
  }
  const memberships = uniqueMembershipOrganisationRows(Array.isArray(data) ? data as Array<Record<string, unknown>> : []);
  const repository = clubRepository(supabase);
  const results = await Promise.all(memberships.map(async (item): Promise<{ data?: MemberHubData; issue?: LoadFailureKind }> => {
    const org = (item.organisation && typeof item.organisation === "object" ? item.organisation : {}) as Record<string, unknown>;
    const organisation = { id: String(org.id), name: String(org.name), slug: String(org.slug), active: org.active !== false, branding: org.branding as never };
    try {
      const profile = await repository.getMemberOperationalProfile(organisation.id, user.id);
      const schedulePromise = supabase.rpc("club_list_my_schedule", { p_organisation_id: organisation.id });
      const [balance, sessions, allBookings, orders, scheduleResult, products] = await Promise.all([
        profile.customer ? repository.getBalanceAccountForCustomer(organisation.id, profile.customer.id) : undefined,
        repository.listClassSessions(organisation.id),
        profile.customer ? repository.listClassBookings(organisation.id) : [],
        repository.listOrders(organisation.id),
        schedulePromise,
        repository.listProducts(organisation.id, true),
      ]);
      const balanceHistoryResult = balance ? await supabase.from("club_balance_entries")
        .select("id,entry_type,amount_delta_minor,created_at").eq("organisation_id", organisation.id)
        .eq("account_id", balance.id).order("created_at", { ascending: false }).limit(3) : { data: [] };
      const balanceHistory = Array.isArray(balanceHistoryResult.data) ? balanceHistoryResult.data.map(value => {
        const entry = value as Record<string, unknown>;
        return { id: String(entry.id), entryType: String(entry.entry_type), amountMinor: Number(entry.amount_delta_minor), createdAt: String(entry.created_at) };
      }) : [];
      const bookings = allBookings.filter((booking) => booking.customerId === profile.customer?.id).map((booking) => ({ sessionId: booking.sessionId, status: booking.status }));
      const schedule = !scheduleResult.error && Array.isArray(scheduleResult.data) ? scheduleResult.data as MemberHubData["schedule"] : [];
      return { data: { organisation, profile, balance, balanceHistory, sessions, bookings, orders, schedule, lifetimeProductIds: products.filter(product => product.isLifetime).map(product => product.id) } };
    } catch (reason) {
      const failure = safeLoadFailureFields(reason);
      console.error("[member-hub] organisation workspace load failed", failure);
      return { issue: failure.kind };
    }
  }));
  const loaded = results.flatMap(result => result.data ? [result.data] : []);
  const loadIssue = results.find(result => result.issue)?.issue;
  return <MemberHub data={loaded} loadIssue={loadIssue}/>;
}
