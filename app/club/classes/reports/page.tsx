import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubClassReports } from "@/components/club-class-reports";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

export default async function ClassReportsPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(supabase, user.id, (await searchParams)?.org);
  if (!context) return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Class reports" /><EmptyState title="Reports unavailable">Select the organisation that owns the class records.</EmptyState><AppNav /></AppShell>;
  const [canManageClasses, canRecordCash, canReconcileCash] = await Promise.all([context.repository.hasCapability(context.organisation.id, user.id, "classes.manage"), context.repository.hasCapability(context.organisation.id, user.id, "payments.record_cash"), context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile")]);
  if (!canManageClasses || (!canRecordCash && !canReconcileCash)) return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Class reports" /><EmptyState title="Class finance reports are restricted">Class management and an authorized cash capability are required.</EmptyState><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to classes</BackButton><AppNav /></AppShell>;
  const to = new Date(); const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [cancellationResult, creditResult] = await Promise.all([
    supabase.rpc("club_list_class_booking_cancellations", { p_organisation_id: context.organisation.id, p_from: from.toISOString(), p_to: to.toISOString() }),
    supabase.rpc("club_list_class_credit_ledger", { p_organisation_id: context.organisation.id, p_from: from.toISOString(), p_to: to.toISOString() }),
  ]);
  if (cancellationResult.error || creditResult.error) return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Class reports" /><EmptyState title="Class reports could not be loaded">No report data was changed. Ask an authorized manager to check the report permissions.</EmptyState><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to classes</BackButton><AppNav /></AppShell>;
  const cancellations = (cancellationResult.data ?? {}) as { cancellations?: never[]; repeatCancellations?: never[] };
  return <AppShell className="module-page club-page club-classes-page"><PageHeader eyebrow="R12 CLUB · CLASS REPORTS" title="Class cancellations and credits" description="90-day management report · repeated cancellations have no automatic penalty." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubClassReports cancellations={(cancellations.cancellations ?? []) as never[]} repeats={(cancellations.repeatCancellations ?? []) as never[]} credits={(creditResult.data ?? []) as never[]} /><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to classes</BackButton><AppNav /></AppShell>;
}
