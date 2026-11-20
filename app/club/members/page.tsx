import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ClubMemberOnboarding } from "@/components/club-member-onboarding";
import { ClubMembersDirectory } from "@/components/club-members-directory";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubMembersPage({ searchParams }: { searchParams?: Promise<{ org?: string; q?: string; status?: string; access?: string; home?: string; plan?: string; sort?: string; dir?: string; page?: string; location?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn&next=%2Fclub%2Fmembers");
  const params = await searchParams;
  const context = await resolveClubOperationalContext(supabase, user.id, params?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.view"))) return <AppShell className="module-page club-page"><PageHeader title="Members" /><EmptyState title="Member access required">Choose an authorised Club organisation.</EmptyState><AppNav /></AppShell>;
  const [members, customers, products, locations, canAssign, canExtendGrace, canReviewPayments] = await Promise.all([
    context.repository.listMemberSummaries(context.organisation.id),
    context.repository.listCustomers(context.organisation.id),
    context.repository.listProducts(context.organisation.id, true),
    context.repository.listLocations(context.organisation.id),
    context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"),
    context.repository.hasCapability(context.organisation.id, user.id, "payments.extend_grace"),
    context.repository.hasCapability(context.organisation.id, user.id, "payments.take"),
  ]);
  const [unlinkedMembershipResult, billingAttentionResult, directoryAccessResult] = await Promise.all([
    supabase.rpc("club_list_unlinked_membership_customers", { p_organisation_id: context.organisation.id }),
    canReviewPayments ? supabase.rpc("club_list_membership_billing_attention", { p_organisation_id: context.organisation.id }) : Promise.resolve({ data: null, error: { message: "not_authorised" } }),
    supabase.rpc("club_list_member_directory_access_facts", { p_organisation_id: context.organisation.id }),
  ]);
  const { data: unlinkedMembershipData, error: unlinkedMembershipError } = unlinkedMembershipResult;
  const accessFactRows = !directoryAccessResult.error && Array.isArray(directoryAccessResult.data) ? directoryAccessResult.data as Array<Record<string, unknown>> : [];
  const accessFactsByCustomer = new Map(accessFactRows.flatMap(row => typeof row.customer_id === "string" ? [[row.customer_id, {
    membershipActive: typeof row.membership_active === "boolean" ? row.membership_active : undefined,
    r12Linked: typeof row.r12_linked === "boolean" ? row.r12_linked : undefined,
    accountVerified: typeof row.account_verified === "boolean" ? row.account_verified : undefined,
    credentialIssued: typeof row.credential_issued === "boolean" ? row.credential_issued : undefined,
    accessEligible: typeof row.access_eligible === "boolean" ? row.access_eligible : undefined,
  }] as const] : []));
  const unlinkedMembershipCustomers = !unlinkedMembershipError && Array.isArray(unlinkedMembershipData)
    ? unlinkedMembershipData.flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.display_name !== "string") return [];
      const customer = customers.find(item => item.id === row.id);
      const home = row.home_location && typeof row.home_location === "object" ? row.home_location as Record<string, unknown> : {};
      const savedHome = typeof home.id === "string" && typeof home.name === "string" ? { id: home.id, name: home.name } : locations.find(location => location.id === customer?.preferredLocationId);
      const facts = accessFactsByCustomer.get(row.id);
      return [{
        id: row.id,
        ...(typeof row.user_id === "string" ? { userId: row.user_id } : {}),
        displayName: row.display_name,
        ...(typeof row.email === "string" && row.email.trim() ? { email: row.email } : customer?.email ? { email: customer.email } : {}),
        ...(typeof row.membership_name === "string" ? { membershipName: row.membership_name } : {}),
        ...(typeof row.membership_status === "string" ? { membershipStatus: row.membership_status } : {}),
        ...(typeof row.directory_status === "string" ? { directoryStatus: row.directory_status } : {}),
        ...(typeof row.membership_ends_at === "string" ? { membershipEndsAt: row.membership_ends_at } : {}),
        ...(facts ? { membershipActive: facts.membershipActive, r12Linked: facts.r12Linked, accountVerified: facts.accountVerified, credentialIssued: facts.credentialIssued, accessEligible: facts.accessEligible } : {}),
        ...(typeof row.phone === "string" && row.phone.trim() ? { phone: row.phone } : customer?.phone ? { phone: customer.phone } : {}),
        ...(savedHome ? { homeLocation: { id: savedHome.id, name: savedHome.name } } : {}),
      }];
    })
    : [];
  const billingRows = !billingAttentionResult.error && Array.isArray(billingAttentionResult.data) ? billingAttentionResult.data as Array<{ user_id?: string; state?: string }> : [];
  const arrearsUserIds = [...new Set(billingRows.filter(row => ["failed", "grace", "overdue", "retry_scheduled"].includes(String(row.state))).map(row => String(row.user_id ?? "")).filter(Boolean))];
  const billingStatusAvailable = !billingAttentionResult.error && Array.isArray(billingAttentionResult.data);
  const customerById = new Map(customers.map(customer => [customer.id, customer]));
  const directoryMembers = members.map(member => {
    const facts = member.customerId ? accessFactsByCustomer.get(member.customerId) : undefined;
    return { ...member, phone: member.customerId ? customerById.get(member.customerId)?.phone : undefined,
      ...(facts ? { membershipActive: facts.membershipActive, r12Linked: facts.r12Linked, accountVerified: facts.accountVerified, credentialIssued: facts.credentialIssued, accessEligible: facts.accessEligible } : {}) };
  });
  const onboardingCustomers = [...new Map([
    ...directoryMembers.filter(member => member.customerId).map(member => {
      const customer = customerById.get(member.customerId!);
      return [member.customerId!, { id: member.customerId!, displayName: member.displayName, email: member.email ?? customer?.email, phone: customer?.phone } ] as const;
    }),
    ...unlinkedMembershipCustomers.map(customer => [customer.id, { id: customer.id, displayName: customer.displayName, email: customer.email, phone: customer.phone }] as const),
  ]).values()];
  const allowedStatuses = new Set(["all", "active", "lapsed", "former", "pending_review", "arrears"]);
  const sort = ["name", "home", "plan", "status", "ends"].includes(params?.sort ?? "") ? params?.sort as "name" | "home" | "plan" | "status" | "ends" : "name";
  const page = Math.max(1, Math.min(100000, Number.parseInt(params?.page ?? "1", 10) || 1));
  const allowedAccess = new Set(["all", "active_membership", "linked", "credential_issued", "access_eligible"]);
  return <AppShell className="module-page club-page">
    <PageHeader title="Members" description="Search member records, manage memberships and open access or billing details." />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    {context.organisation.id === "fa44592a-1593-4ad3-a621-63a4a4bcbceb" && ["owner", "gym_admin"].includes(context.role) ? <Surface><div className="section-heading"><div><h2>R12 member activation</h2><p className="muted">Preview current members who can securely link their existing membership.</p></div><Link className="primary" href={`/club/members/activation?org=${encodeURIComponent(context.organisation.id)}`}>Invite existing members to R12</Link></div></Surface> : null}
    {canAssign ? <Surface><ClubMemberOnboarding organisationId={context.organisation.id} organisationSlug={context.organisation.slug} customers={onboardingCustomers} products={products} locations={locations.filter(location => location.active).map(location => ({ id: location.id, name: location.name }))} role={context.role} canAssign={canAssign} /></Surface> : null}
    <Surface><ClubMembersDirectory members={directoryMembers} customers={unlinkedMembershipCustomers} organisationId={context.organisation.id} billingStatusAvailable={billingStatusAvailable} arrearsUserIds={arrearsUserIds} initialQuery={params?.q ?? ""} initialStatus={allowedStatuses.has(params?.status ?? "") ? params?.status : "all"} initialAccess={allowedAccess.has(params?.access ?? "") ? params?.access : "all"} initialHome={params?.home ?? "all"} initialPlan={params?.plan ?? "all"} initialSort={sort} initialDirection={params?.dir === "desc" ? "desc" : "asc"} initialPage={page} /></Surface>
    {canExtendGrace ? <Surface><h2>Authorised payment grace</h2><p className="muted">Open a member profile to review failed or overdue obligations. Payment remains outstanding until genuinely recovered.</p></Surface> : null}
    <AppNav />
  </AppShell>;
}
