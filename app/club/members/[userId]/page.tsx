/* eslint-disable react-hooks/error-boundaries */
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext, isClubStaffRole } from "@/lib/club-server-context";
import { membershipPresentation } from "@/lib/club-membership-presentation";
import { formatClubMemberDisplayName } from "@/lib/club-member-directory";
import type { GraceExtensionContext } from "@/lib/club-payment-grace";
import { type EditableCustomerProfile } from "@/components/club-member-profile-editor";
import { type MembershipManagementDetail } from "@/components/club-membership-manager";
import { ClubMemberProfileLayout } from "@/components/club-member-profile-layout";

type BillingRow = { id: string; amount_minor: number; currency: string; state: string; next_due_at: string; payment_method_family?: string; provider_type?: string; stripe_merchant_entity?: string | null; provider_status?: string; provider_charge_date?: string; mandate_status?: string; collection_status?: string; action_required_reason?: string };
type JoinState = { id: string; status: string; product_name: string; location_name?: string; payment_state: string; checkout_kind?: string; upfront_amount_minor?: number; upfront_payment_state?: string; recurring_authority_state?: string; membership_id?: string; updated_at: string };


export default async function ClubMemberProfilePage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams?: Promise<{ org?: string; returnTo?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const { userId } = await params;
  const pageParams = await searchParams;
  const context = await resolveClubOrganisationContext(supabase, user.id, pageParams?.org);
  if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader title="Member" description="This profile is available to authorised Club staff." /><EmptyState title="Club access required">Ask an organisation owner to confirm your operational role.</EmptyState><AppNav /></AppShell>;

  try {
    const member = context.members.find(item => item.userId === decodeURIComponent(userId));
    if (!member) return <AppShell className="module-page club-page"><PageHeader title="Member" /><EmptyState title="Member not found">This person is not part of the selected organisation.</EmptyState><AppNav /></AppShell>;
    const [profile, orders, products, joinResult, canChangeMembershipAccess, customers, canManageHousehold, canPerformInduction, canExtendPaymentGrace, locations, canEditMemberContact, canViewEmergencyContact, canManageOrders, canManageMemberships, canRecordMembershipCash] = await Promise.all([
      context.repository.getMemberOperationalProfile(context.organisation.id, member.userId),
      context.repository.listOrders(context.organisation.id),
      context.repository.listProducts(context.organisation.id, true),
      supabase.rpc("club_get_member_join_state", { p_organisation_id: context.organisation.id, p_user_id: member.userId }),
      context.repository.hasCapability(context.organisation.id, user.id, "memberships.end_immediately"),
      context.repository.listCustomers(context.organisation.id),
      context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"),
      context.repository.hasCapability(context.organisation.id, user.id, "induction.perform"),
      context.repository.hasCapability(context.organisation.id, user.id, "payments.extend_grace"),
      context.repository.listLocations(context.organisation.id),
      context.repository.hasCapability(context.organisation.id, user.id, "members.create"),
      context.repository.hasCapability(context.organisation.id, user.id, "members.view"),
      context.repository.hasCapability(context.organisation.id, user.id, "finance.manage"),
      context.repository.hasCapability(context.organisation.id, user.id, "memberships.manage"),
      context.repository.hasCapability(context.organisation.id, user.id, "payments.record_cash"),
    ]);
    const customer = profile.customer;
    const [contactResult, editableProfileResult, membershipDetailResults] = await Promise.all([
      customer && canEditMemberContact ? supabase.rpc("club_get_member_contact_secure", { p_organisation_id: context.organisation.id, p_user_id: member.userId }) : Promise.resolve({ data: null, error: null }),
      customer && canEditMemberContact ? supabase.rpc("club_get_customer_profile_details", { p_organisation_id: context.organisation.id, p_customer_id: customer.id }) : Promise.resolve({ data: null, error: null }),
      canManageMemberships ? Promise.all(profile.memberships.map(item => supabase.rpc("club_get_membership_management_detail", { p_organisation_id: context.organisation.id, p_membership_id: item.id }))) : Promise.resolve([]),
    ]);
    const editableProfile = editableProfileResult.data && typeof editableProfileResult.data === "object" ? editableProfileResult.data as EditableCustomerProfile : undefined;
    const membershipDetails = new Map(profile.memberships.flatMap((item, index) => {
      const data = membershipDetailResults[index]?.data;
      return data && typeof data === "object" ? [[item.id, data as MembershipManagementDetail] as const] : [];
    }));
    const contact = contactResult.data && typeof contactResult.data === "object" ? contactResult.data as { phone?: string | null; address_line_1?: string | null; address_line_2?: string | null; town_city?: string | null; postcode?: string | null } : undefined;
    const emergencyResult = customer && canViewEmergencyContact ? await supabase.rpc("club_get_member_emergency_contact", { p_organisation_id: context.organisation.id, p_customer_id: customer.id }) : { data: null, error: null };
    const emergency = emergencyResult.data && typeof emergencyResult.data === "object" ? emergencyResult.data as { name?: string | null; phone?: string | null } : undefined;
    const current = profile.memberships.find(item => item.status === "active") ?? profile.memberships.find(item => item.status === "paused");
    const currentPresentation = current ? membershipPresentation(current.productName, products.some(product => product.id === current.productId && product.isLifetime)) : undefined;
    const [safetyResult, householdResult] = customer ? await Promise.all([
      supabase.rpc("club_get_member_access_safety", { p_organisation_id: context.organisation.id, p_customer_id: customer.id, p_location_id: null }),
      current ? supabase.rpc("club_get_membership_household", { p_organisation_id: context.organisation.id, p_membership_id: current.id }) : Promise.resolve({ data: null }),
    ]) : [{ data: null }, { data: null }];
    const safety = safetyResult.data && typeof safetyResult.data === "object" ? safetyResult.data as { ageState?: string; inductionState?: string; inductionRequired?: boolean; twentyFourHourEligible?: boolean; membershipEligible?: boolean; inductionBooking?: { id?: string; startsAt?: string; locationId?: string } | null } : undefined;
    const household = Array.isArray(householdResult.data) ? householdResult.data as Array<{ customerId: string; displayName?: string; billingContact?: boolean; coverageRole?: "adult" | "child" | "other" }> : [];
    const [balance, billingResult] = await Promise.all([
      customer ? context.repository.getBalanceAccountForCustomer(context.organisation.id, customer.id) : undefined,
      customer ? supabase.rpc("club_list_customer_billing_secure", { p_organisation_id: context.organisation.id, p_customer_id: customer.id }) : Promise.resolve({ data: [] }),
    ]);
    const billingRows = Array.isArray(billingResult.data) ? billingResult.data as BillingRow[] : [];
    const graceContexts = canExtendPaymentGrace ? new Map((await Promise.all(billingRows.map(async row => {
      const result = await supabase.rpc("club_get_payment_grace_extension_context", { p_organisation_id: context.organisation.id, p_obligation_id: row.id });
      return result.error || !result.data ? undefined : [row.id, result.data as GraceExtensionContext] as const;
    }))).filter((entry): entry is readonly [string, GraceExtensionContext] => Boolean(entry))) : new Map<string, GraceExtensionContext>();
    const joinState = !joinResult.error && joinResult.data && typeof joinResult.data === "object" ? joinResult.data as JoinState : undefined;
    const memberOrders = orders.filter(order => order.userId === member.userId || (customer && order.customerId === customer.id));
    return <AppShell className="module-page club-page"><PageHeader title={formatClubMemberDisplayName(customer?.displayName)} /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
      <ClubMemberProfileLayout organisationId={context.organisation.id} organisationSlug={context.organisation.slug} memberUserId={member.userId} memberRole={context.role} profile={profile} customerId={customer?.id} contact={contact} emergency={emergency} editableProfile={editableProfile} canEditMemberContact={canEditMemberContact} editLoadFailed={Boolean(editableProfileResult.error)} safety={safety} current={current} currentPresentation={currentPresentation} membershipDetails={membershipDetails} products={products} locations={locations} household={household} customers={customers.map(person => ({ id: person.id, displayName: person.displayName }))} canManageHousehold={canManageHousehold} canChangeMembershipAccess={canChangeMembershipAccess} canManageMemberships={canManageMemberships} canRecordMembershipCash={canRecordMembershipCash} canPerformInduction={canPerformInduction} canManageOrders={canManageOrders} joinState={joinState} billingRows={billingRows} graceContexts={graceContexts} balance={balance} memberOrders={memberOrders} />
      <Link className="club-profile-back" href={pageParams?.returnTo?.startsWith("/club/members?") ? pageParams.returnTo : `/club/members?org=${encodeURIComponent(context.organisation.id)}`}>‹ <span>Back to members</span></Link><AppNav />
    </AppShell>;
  } catch {
    return <AppShell className="module-page club-page"><PageHeader title="Member" /><EmptyState title="Member profile couldn’t be loaded.">Try again shortly.</EmptyState><AppNav /></AppShell>;
  }
}
