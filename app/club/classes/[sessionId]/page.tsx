import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubClassRegister } from "@/components/club-class-register";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

type Register = { sessionId: string; capacity: number; reserved: number; spacesRemaining: number; roster: Array<{ bookingId: string; customerId: string; memberName: string; status: string; attendanceState: string; paymentMethod: string | null; paymentStatus: string; amountMinor: number | null; cashStatus: string | null; cashDue: number; cancelledAt: string | null }> };
type MemberChoice = { id: string; name: string };

export default async function ClassRegisterPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const route = await params; const query = await searchParams;
  const context = await resolveClubOrganisationContext(supabase, user.id, query?.org);
  if (!context) return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Class register" /><EmptyState title="Class register unavailable">Choose the correct Club organisation or ask a manager to check your access.</EmptyState><AppNav /></AppShell>;
  const session = (await context.repository.listClassSessions(context.organisation.id)).find(item => item.id === route.sessionId);
  if (!session) return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Class register" /><EmptyState title="Class not found">This class session is not available in the selected Club.</EmptyState><AppNav /></AppShell>;
  const locationName = (await context.repository.listLocations(context.organisation.id)).find(location => location.id === session.locationId)?.name ?? "Location unavailable";
  const { data: registerData, error } = await supabase.rpc("club_get_host_class_register", { p_session_id: session.id });
  if (error || !registerData) return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title={session.title ?? "Class register"} /><EmptyState title="Class register access is restricted">The actual class host or authorised Club staff can open this register.</EmptyState><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to classes</BackButton><AppNav /></AppShell>;
  const register = registerData as Register;
  const canCollectCash = await context.repository.hasCapability(context.organisation.id, user.id, "payments.record_cash");
  const canReconcileCash = await context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile");
  const { data: membersData } = canCollectCash ? await supabase.rpc("club_staff_list_class_members", { p_session_id: session.id }) : { data: [] };
  const members = Array.isArray(membersData) ? membersData as MemberChoice[] : [];
  return <AppShell className="module-page club-page club-classes-page"><PageHeader eyebrow="R12 CLUB · CLASS REGISTER" title={session.title ?? "Class register"} description={`${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" }).format(new Date(session.startsAt))} · ${locationName}`} /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubClassRegister sessionId={session.id} capacity={register.capacity} reserved={register.reserved} roster={register.roster ?? []} members={members} canCollectCash={canCollectCash} canReconcileCash={canReconcileCash} /><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to classes</BackButton><AppNav /></AppShell>;
}
