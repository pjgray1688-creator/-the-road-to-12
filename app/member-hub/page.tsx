import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { MemberHub, type MemberHubData } from "@/components/member-hub";

export default async function MemberHubPage() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub");
  const { data, error } = await supabase.rpc("club_list_my_memberships");
  if (error) return <MemberHub data={[]} />;
  const memberships = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const repository = clubRepository(supabase); const loaded: MemberHubData[] = [];
  for (const item of memberships) { const org = (item.organisation && typeof item.organisation === "object" ? item.organisation : {}) as Record<string, unknown>; const organisation = { id: String(org.id), name: String(org.name), slug: String(org.slug), active: org.active !== false, branding: org.branding as never }; try { const profile = await repository.getMemberOperationalProfile(organisation.id, user.id); const balance = profile.customer ? await repository.getBalanceAccountForCustomer(organisation.id, profile.customer.id) : undefined; const sessions = await repository.listClassSessions(organisation.id); const bookings = profile.customer ? (await repository.listClassBookings(organisation.id)).filter(b => b.customerId === profile.customer!.id).map(b => ({ sessionId: b.sessionId, status: b.status })) : []; const orders = await repository.listOrders(organisation.id); loaded.push({ organisation, profile, balance, sessions, bookings, orders }); } catch { /* An invalid/inactive relationship is not exposed. */ } }
  return <MemberHub data={loaded}/>;
}
