import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { MemberHub, type MemberHubData } from "@/components/member-hub";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { reviewerMemberHubData } from "@/lib/play-reviewer-member-data";

export default async function MemberHubPage() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub");
  if (hasPlayReviewerEntitlement(user)) return <MemberHub data={reviewerMemberHubData()} demoMode />;
  const { data, error } = await supabase.rpc("club_list_my_memberships");
  if (error) return <MemberHub data={[]} />;
  const memberships = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const repository = clubRepository(supabase); const loaded: MemberHubData[] = [];
  for (const item of memberships) {
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
      loaded.push({ organisation, profile, balance, balanceHistory, sessions, bookings, orders, schedule, lifetimeProductIds: products.filter(product => product.isLifetime).map(product => product.id) });
    } catch { /* An invalid/inactive relationship is not exposed. */ }
  }
  return <MemberHub data={loaded}/>;
}
