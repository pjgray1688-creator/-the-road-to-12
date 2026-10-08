import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { MemberHub, type MemberHubData } from "@/components/member-hub";
import type { MemberAccessPassData } from "@/components/member-access-pass";

export default async function MemberHubPage() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub");
  const { data, error } = await supabase.rpc("club_list_my_memberships");
  if (error) return <MemberHub data={[]} />;
  const memberships = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const repository = clubRepository(supabase); const loaded: MemberHubData[] = [];
  for (const item of memberships) {
    const org = (item.organisation && typeof item.organisation === "object" ? item.organisation : {}) as Record<string, unknown>;
    const organisation = { id: String(org.id), name: String(org.name), slug: String(org.slug), active: org.active !== false, branding: org.branding as never };
    try {
      const profile = await repository.getMemberOperationalProfile(organisation.id, user.id);
      const accessPassPromise = organisation.slug.toLowerCase().includes("madhouse")
        ? supabase.rpc("club_get_my_access_pass", { p_organisation_id: organisation.id })
        : Promise.resolve({ data: null, error: null });
      const schedulePromise = supabase.rpc("club_list_my_schedule", { p_organisation_id: organisation.id });
      const [balance, sessions, allBookings, orders, accessPassResult, scheduleResult] = await Promise.all([
        profile.customer ? repository.getBalanceAccountForCustomer(organisation.id, profile.customer.id) : undefined,
        repository.listClassSessions(organisation.id),
        profile.customer ? repository.listClassBookings(organisation.id) : [],
        repository.listOrders(organisation.id),
        accessPassPromise,
        schedulePromise,
      ]);
      const bookings = allBookings.filter((booking) => booking.customerId === profile.customer?.id).map((booking) => ({ sessionId: booking.sessionId, status: booking.status }));
      const accessPass = accessPassResult.error || !accessPassResult.data ? undefined : accessPassResult.data as MemberAccessPassData;
      const schedule = !scheduleResult.error && Array.isArray(scheduleResult.data) ? scheduleResult.data as MemberHubData["schedule"] : [];
      loaded.push({ organisation, profile, balance, sessions, bookings, orders, accessPass, schedule });
    } catch { /* An invalid/inactive relationship is not exposed. */ }
  }
  return <MemberHub data={loaded}/>;
}
