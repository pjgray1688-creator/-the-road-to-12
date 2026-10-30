import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubMemberOnboarding } from "@/components/club-member-onboarding";
import { ClubMembersDirectory } from "@/components/club-members-directory";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubMembersPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn&next=%2Fclub%2Fmembers");
  const context = await resolveClubOperationalContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.view"))) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · MEMBERS" title="Members" /><EmptyState title="Member access required">Choose an authorised Club organisation.</EmptyState><AppNav /></AppShell>;

  const [members, customers, products, canAssign, canImport, canExtendGrace] = await Promise.all([
    context.repository.listMemberSummaries(context.organisation.id),
    context.repository.listCustomers(context.organisation.id),
    context.repository.listProducts(context.organisation.id, true),
    context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"),
    context.repository.hasCapability(context.organisation.id, user.id, "members.import"),
    context.repository.hasCapability(context.organisation.id, user.id, "payments.extend_grace"),
  ]);
  const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page">
    <PageHeader eyebrow="R12 CLUB · MEMBERS" title="Members" description="Search member records, manage memberships and open access or billing details." />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <Surface><div className="section-header"><div><span className="eyebrow">MEMBER DIRECTORY</span><h2>Find a member</h2></div>{canImport ? <Link className="secondary" href={`/club/members/import${query}`}>Import members</Link> : null}</div><ClubMembersDirectory members={members} customers={customers} organisationId={context.organisation.id} /></Surface>
    {canAssign ? <Surface><span className="eyebrow">MEMBERSHIP MANAGEMENT</span><h2>Add or update a member</h2><p className="muted">Individual, Couples and Family memberships retain separate member identities and their existing billing relationship.</p><ClubMemberOnboarding organisationId={context.organisation.id} organisationSlug={context.organisation.slug} customers={customers} products={products} role={context.role} canAssign={canAssign} /></Surface> : null}
    {canExtendGrace ? <Surface><span className="eyebrow">PAYMENT ARRANGEMENTS</span><h2>Authorised payment grace</h2><p className="muted">Open a member profile to review a failed or overdue obligation and its immutable extension history. Payment remains outstanding until genuinely recovered.</p></Surface> : null}
    <AppNav />
  </AppShell>;
}
