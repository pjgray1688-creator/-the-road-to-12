import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubEmailPreview } from "@/components/club-email-preview";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { renderNotification } from "@/lib/notification-templates";

export default async function ClubEmailPreviewPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Fstaff%2Femail-preview");
  const context = await resolveClubOperationalContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "staff.permissions_manage"))) return <AppShell className="module-page club-page"><PageHeader title="Email preview"/><EmptyState title="Management access required">Only authorised staff managers may preview or send allowlisted test emails.</EmptyState><AppNav /></AppShell>;
  const samples = {
    staff_owner: { templateKey: "staff_invitation" as const, payload: { name: "Keenan", email: "keenan@example.test", role: "owner", coachEnabled: true, organisationName: context.organisation.name, venueNames: ["Rotherham", "Carlton"], expiresAt: "2026-11-14T12:00:00Z", grantId: "example-only", testMode: true } },
    staff_coach: { templateKey: "staff_invitation" as const, payload: { name: "Luke", email: "luke@example.test", role: "trainer", coachEnabled: true, organisationName: context.organisation.name, venueNames: ["Rotherham", "Carlton"], expiresAt: "2026-11-14T12:00:00Z", grantId: "example-only", testMode: true } },
    member_activation: { templateKey: "member_activation" as const, payload: { name: "Alex", organisationName: context.organisation.name, testMode: true } },
  };
  const previews = Object.fromEntries(Object.entries(samples).map(([key, sample]) => { const rendered = renderNotification(sample); return [key, { fromName: rendered.senderName, fromAddress: rendered.senderAddress, subject: rendered.subject, destinationType: rendered.destinationType, testPreview: true, text: rendered.text, html: rendered.html }]; })) as Record<"staff_owner" | "staff_coach" | "member_activation", { fromName: string; fromAddress: string; subject: string; destinationType: string; testPreview: boolean; text: string; html: string }>;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · STAFF" title="Email preview & test" description="Review the Owner, PT / Coach and member activation emails using example data only."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><Surface><ClubEmailPreview organisationId={context.organisation.id} previews={previews}/></Surface><BackButton href={`/club/staff?org=${encodeURIComponent(context.organisation.id)}`}>Back to Staff</BackButton><Link href={`/club/members/import?org=${encodeURIComponent(context.organisation.id)}`} className="member-hub-link">Member import</Link><AppNav/></AppShell>;
}
