import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { resolveClubCapabilities } from "@/lib/club-capabilities";
// Staff rows keep role, active state and capability summary visually distinct.

export default async function ClubStaffPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOperationalContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !["gym_admin", "owner"].includes(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Staff" description="Staff management is restricted to organisation managers." /><EmptyState title="Management access required">Ask an owner to review your Club role.</EmptyState><AppNav /></AppShell>;
  const members = await context.repository.listMembers(context.organisation.id); const staff = members.filter(member => ["gym_staff","gym_admin","owner"].includes(member.role)); const capabilities = resolveClubCapabilities(context.role);
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · STAFF" title="Who’s working?" description="Review operational identity and capability presets." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><span className="eyebrow">STAFF PROFILES</span>{staff.length ? staff.map(member => <div className="club-detail-row" key={member.id}><span><strong>{member.role === "owner" ? "Owner" : member.role === "gym_admin" ? "Manager" : "Staff profile"}</strong><small className="muted">{member.active ? "Active profile" : "Inactive profile"}</small></span><span className="muted">{capabilities.length} capabilities</span></div>) : <p className="muted">No operational staff profiles are configured.</p>}</Surface><Surface><span className="eyebrow">YOUR CAPABILITIES</span><p className="muted">Inherited from your role. Sensitive actions remain separately controlled.</p><div className="club-detail-row"><span>Members and operations</span><span>{capabilities.filter(item => item.startsWith("members.") || item.startsWith("classes.") || item.startsWith("services.")).length} enabled</span></div><div className="club-detail-row"><span>Payments and reconciliation</span><span>{capabilities.filter(item => item.startsWith("payments.") || item.startsWith("cash.") || item.startsWith("refunds.")).length} enabled</span></div></Surface><BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>;
}
