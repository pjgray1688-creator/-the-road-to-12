/* eslint-disable react-hooks/error-boundaries */
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext, isClubStaffRole } from "@/lib/club-server-context";
import { entitlementLabel, orderStateLabel } from "@/lib/club-operational";
import { ClubMembershipAssignment } from "@/components/club-membership-assignment";
import { ClubMembershipAccessStatus } from "@/components/club-membership-access-status";
import { ClubMembershipHousehold } from "@/components/club-membership-household";
import { ClubMemberInductionCompletion } from "@/components/club-member-induction-completion";

type BillingRow = { id: string; amount_minor: number; currency: string; state: string; next_due_at: string; payment_method_family?: string; provider_status?: string; provider_charge_date?: string; mandate_status?: string; collection_status?: string; action_required_reason?: string };
type JoinState = { id: string; status: string; product_name: string; location_name?: string; payment_state: string; checkout_kind?: string; upfront_amount_minor?: number; upfront_payment_state?: string; recurring_authority_state?: string; updated_at: string };

const membershipLabel = (status: string) => status.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const accessReason = (reason?: string) => ({ membership_not_started: "Membership has not started", membership_expired: "Membership has expired", membership_inactive: "Membership is inactive", gym_access_missing: "No gym access benefit is currently active", location_not_included: "This location is not included", location_inactive: "Location is inactive", cash_pending: "Awaiting cash verification" }[reason ?? ""] ?? reason?.replace(/_/g, " "));
const money = (minor: number, currency = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

export default async function ClubMemberProfilePage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const { userId } = await params;
  const context = await resolveClubOrganisationContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader title="Member" description="This profile is available to authorised Club staff." /><EmptyState title="Club access required">Ask an organisation owner to confirm your operational role.</EmptyState><AppNav /></AppShell>;

  try {
    const member = context.members.find(item => item.userId === decodeURIComponent(userId));
    if (!member) return <AppShell className="module-page club-page"><PageHeader title="Member" /><EmptyState title="Member not found">This person is not part of the selected organisation.</EmptyState><AppNav /></AppShell>;
    const [profile, orders, products, joinResult, canChangeMembershipAccess, customers, canManageHousehold, canPerformInduction, locations] = await Promise.all([
      context.repository.getMemberOperationalProfile(context.organisation.id, member.userId),
      context.repository.listOrders(context.organisation.id),
      context.repository.listProducts(context.organisation.id, true),
      supabase.rpc("club_get_member_join_state", { p_organisation_id: context.organisation.id, p_user_id: member.userId }),
      context.repository.hasCapability(context.organisation.id, user.id, "memberships.end_immediately"),
      context.repository.listCustomers(context.organisation.id),
      context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"),
      context.repository.hasCapability(context.organisation.id, user.id, "induction.perform"),
      context.repository.listLocations(context.organisation.id),
    ]);
    const customer = profile.customer;
    const current = profile.memberships.find(item => item.status === "active") ?? profile.memberships[0];
    const [safetyResult, householdResult] = customer ? await Promise.all([
      supabase.rpc("club_get_member_access_safety", { p_organisation_id: context.organisation.id, p_customer_id: customer.id, p_location_id: null }),
      current ? supabase.rpc("club_get_membership_household", { p_organisation_id: context.organisation.id, p_membership_id: current.id }) : Promise.resolve({ data: null }),
    ]) : [{ data: null }, { data: null }];
    const safety = safetyResult.data && typeof safetyResult.data === "object" ? safetyResult.data as { ageState?: string; inductionState?: string; inductionRequired?: boolean; twentyFourHourEligible?: boolean; membershipEligible?: boolean; inductionBooking?: { id?: string; startsAt?: string } | null } : undefined;
    const household = Array.isArray(householdResult.data) ? householdResult.data as Array<{ customerId: string; displayName?: string; billingContact?: boolean }> : [];
    const [balance, billingResult] = await Promise.all([
      customer ? context.repository.getBalanceAccountForCustomer(context.organisation.id, customer.id) : undefined,
      customer ? supabase.rpc("club_list_customer_billing", { p_organisation_id: context.organisation.id, p_customer_id: customer.id }) : Promise.resolve({ data: [] }),
    ]);
    const billingRows = Array.isArray(billingResult.data) ? billingResult.data as BillingRow[] : [];
    const joinState = !joinResult.error && joinResult.data && typeof joinResult.data === "object" ? joinResult.data as JoinState : undefined;
    const access = profile.access?.state ?? "unavailable";
    const memberOrders = orders.filter(order => order.userId === member.userId || (customer && order.customerId === customer.id));
    return <AppShell className="module-page club-page"><PageHeader eyebrow="MEMBER PROFILE" title={customer?.displayName ?? "Person"} description={customer?.email ?? "R12 account linked"} /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><div className="club-profile-grid club-profile-polished">
      <Surface><span className="eyebrow">IDENTITY</span><h2>{customer?.displayName ?? "Person"}</h2><p className="muted">{customer?.email ?? "No email recorded"}</p><p className="muted">R12 account linked</p></Surface>
      <Surface><span className="eyebrow">MEMBERSHIP</span><h2>{current?.productName ?? "No active membership"}</h2><p className="muted">{current ? `${membershipLabel(current.status)} · ${new Date(current.startsAt).toLocaleDateString("en-GB")}${current.endsAt ? ` → ${new Date(current.endsAt).toLocaleDateString("en-GB")}` : " · Open-ended"}` : joinState ? `${joinState.product_name} joining is ${joinState.status.replaceAll("_", " ")}. Access has not been activated.` : "No membership is currently recorded."}</p>{current ? <ClubMembershipHousehold organisationId={context.organisation.id} membershipId={current.id} holders={household.map(holder => ({ customerId: holder.customerId, displayName: holder.displayName ?? "Member", billingContact: holder.billingContact === true }))} candidates={customers.map(person => ({ id: person.id, displayName: person.displayName }))} canManage={canManageHousehold} /> : null}{current && canChangeMembershipAccess ? <ClubMembershipAccessStatus organisationId={context.organisation.id} membershipId={current.id} status={current.status} /> : null}{["gym_admin", "owner"].includes(context.role) ? <ClubMembershipAssignment organisationId={context.organisation.id} organisationSlug={context.organisation.slug} userId={member.userId} products={products} /> : null}</Surface>
      <Surface><span className="eyebrow">ACCESS</span><h2>{access === "active" ? "Access active" : access === "needs_attention" ? "Access needs attention" : "Gym access unavailable"}</h2><p className="muted">{profile.access?.policy === "future_locations" ? "All current and future locations" : profile.access?.policy === "organisation" ? "All assigned locations" : profile.access?.policy === "locations" ? "Selected locations" : "No active membership with gym access."}</p>{profile.homeLocation ? <p className="muted">Home gym: {profile.homeLocation.name} · preference only</p> : null}{profile.access?.reason ? <p className="muted">{accessReason(profile.access.reason)}</p> : null}<p className="muted">Age: {({ adult: "18 or over", under_18: "Under 18 — no 24-hour door access", under_16: "Under 16 — restricted; staff review required", missing_date_of_birth: "Date of birth missing — access eligibility needs review", date_of_birth_conflict: "Date of birth conflict — resolve before access" } as Record<string, string>)[safety?.ageState ?? ""] ?? "Age not verified"}</p><p className="muted">Induction: {safety?.inductionRequired ? (safety.inductionState === "complete" ? "Complete" : safety.inductionState === "overdue" ? "Overdue" : safety.inductionState === "due" ? "Due — within grace" : safety.inductionState === "booked" ? "Booked" : "Required") : "Not required"}</p><ClubMemberInductionCompletion organisationId={context.organisation.id} customerId={customer?.id ?? ""} bookingId={safety?.inductionBooking?.id} startsAt={safety?.inductionBooking?.startsAt} locations={locations.filter(location => location.active).map(location => ({ id: location.id, name: location.name }))} canPerform={canPerformInduction} required={safety?.inductionRequired === true} /><p className="muted">24-hour door access: {safety?.twentyFourHourEligible ? "Eligible" : "Not eligible or requires review"}</p></Surface>
      <Surface><span className="eyebrow">JOINING &amp; BILLING</span>{joinState ? <><div className="club-detail-row"><span>{joinState.product_name}<small>{joinState.location_name ?? "Madhouse"} · Updated {new Date(joinState.updated_at).toLocaleString("en-GB")}</small></span><strong>{membershipLabel(joinState.status)}</strong></div><div className="club-detail-row"><span>Upfront card payment<small>{joinState.upfront_amount_minor != null ? money(joinState.upfront_amount_minor) : "Amount unavailable"}</small></span><strong>{membershipLabel(joinState.upfront_payment_state ?? joinState.payment_state)}</strong></div>{joinState.checkout_kind === "monthly_recurring" ? <div className="club-detail-row"><span>Recurring Direct Debit<small>Required for future monthly collections</small></span><strong>{membershipLabel(joinState.recurring_authority_state ?? "required")}</strong></div> : null}</> : null}{billingRows.map(row => <div className="club-detail-row" key={row.id}><span>Recurring payment<small>{row.provider_charge_date ? `Charge date ${new Date(row.provider_charge_date).toLocaleDateString("en-GB")}` : `Due ${new Date(row.next_due_at).toLocaleDateString("en-GB")}`} · Mandate {membershipLabel(row.mandate_status ?? "pending")}{row.action_required_reason ? " · Action required" : ""}</small></span><strong>{membershipLabel(row.provider_status ?? row.state)} · {money(row.amount_minor, row.currency)}</strong></div>)}{!joinState && !billingRows.length ? <p className="muted">No joining checkout or recurring billing state is recorded.</p> : null}</Surface>
      <Surface><span className="eyebrow">ENTITLEMENTS</span>{profile.entitlements.length ? profile.entitlements.map(grant => <div className="club-detail-row" key={grant.id}><span>{entitlementLabel(grant.entitlementKey)}</span><span className="muted">{grant.endsAt ? `Until ${new Date(grant.endsAt).toLocaleDateString("en-GB")}` : "Open-ended"}</span></div>) : <p className="muted">No active entitlements.</p>}</Surface>
      <Surface><span className="eyebrow">ACCOUNT &amp; PURCHASES</span><div className="club-detail-row"><span aria-label="Gym Balance">Madhouse Balance</span><span>{money(balance?.balanceMinor ?? 0)}</span></div>{memberOrders.slice(0, 5).map(order => <div className="club-detail-row" key={order.id}><span>{order.items.map(item => item.productName).join(", ") || "Club order"}</span><span>{orderStateLabel(order.status)} · {money(order.totalMinor, order.currency)}</span></div>)}</Surface>
    </div><BackButton href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}>Back to members</BackButton><AppNav /></AppShell>;
  } catch {
    return <AppShell className="module-page club-page"><PageHeader title="Member" /><EmptyState title="Member profile couldn’t be loaded.">Try again shortly.</EmptyState><AppNav /></AppShell>;
  }
}
