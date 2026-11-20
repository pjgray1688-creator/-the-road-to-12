import Link from "next/link";
import { Surface } from "@/components/ui";
import { ClubMembershipAssignment } from "@/components/club-membership-assignment";
import { ClubMembershipAccessStatus } from "@/components/club-membership-access-status";
import { ClubMembershipHousehold } from "@/components/club-membership-household";
import { ClubMemberInductionCompletion } from "@/components/club-member-induction-completion";
import { ClubMembershipEligibility } from "@/components/club-membership-eligibility";
import { ClubMembershipGraceExtension } from "@/components/club-membership-grace-extension";
import type { GraceExtensionContext } from "@/lib/club-payment-grace";
import { ClubMemberProfileEditor, type EditableCustomerProfile } from "@/components/club-member-profile-editor";
import { ClubMembershipManager, type MembershipManagementDetail } from "@/components/club-membership-manager";
import { entitlementLabel, orderStateLabel } from "@/lib/club-operational";
import { membershipPresentation } from "@/lib/club-membership-presentation";
import { membershipSupportsAdditionalPerson } from "@/lib/madhouse-catalogue";
import { formatClubDate, membershipPaidThroughDate } from "@/lib/club-date-display";
import { uniqueMemberEntitlements } from "@/lib/club-member-entitlement-view";
import type { ClubMemberOperationalRead } from "@/lib/club-operational";
import type { ClubBalanceAccount, ClubOrder } from "@/lib/club-commerce";
import type { ClubProduct, OrganisationLocation } from "@/lib/club";
import styles from "./club-member-profile-layout.module.css";

type BillingRow = { id: string; amount_minor: number; currency: string; state: string; next_due_at: string; payment_method_family?: string; provider_type?: string; stripe_merchant_entity?: string | null; provider_status?: string; provider_charge_date?: string; mandate_status?: string; collection_status?: string; action_required_reason?: string };
type JoinState = { id: string; status: string; product_name: string; location_name?: string; payment_state: string; checkout_kind?: string; upfront_amount_minor?: number; upfront_payment_state?: string; recurring_authority_state?: string; membership_id?: string; updated_at: string };
type Contact = { phone?: string | null; address_line_1?: string | null; address_line_2?: string | null; town_city?: string | null; postcode?: string | null };
type Emergency = { name?: string | null; phone?: string | null };
type Safety = { ageState?: string; inductionState?: string; inductionRequired?: boolean; twentyFourHourEligible?: boolean; membershipEligible?: boolean; inductionBooking?: { id?: string; startsAt?: string; locationId?: string } | null };
type Household = Array<{ customerId: string; displayName?: string; billingContact?: boolean; coverageRole?: "adult" | "child" | "other" }>;

const membershipLabel = (status: string) => status.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const accessReason = (reason?: string) => ({ membership_not_started: "Membership has not started", membership_expired: "Membership has expired", membership_inactive: "Membership is inactive", gym_access_missing: "No active gym access benefit", location_not_included: "This location is not included", location_inactive: "Location is inactive", cash_pending: "Awaiting cash verification" }[reason ?? ""] ?? reason?.replace(/_/g, " "));
const money = (minor: number, currency = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

export function ClubMemberProfileLayout({ organisationId, organisationSlug, memberUserId, memberRole, profile, customerId, contact, emergency, editableProfile, canEditMemberContact, editLoadFailed, safety, current, currentPresentation, membershipDetails, products, locations, household, customers, canManageHousehold, canChangeMembershipAccess, canManageMemberships, canRecordMembershipCash, canPerformInduction, canManageOrders, joinState, billingRows, graceContexts, balance, memberOrders }: {
  organisationId: string; organisationSlug: string; memberUserId: string; memberRole: string; profile: ClubMemberOperationalRead;
  customerId?: string; contact?: Contact; emergency?: Emergency; editableProfile?: EditableCustomerProfile;
  canEditMemberContact: boolean; editLoadFailed: boolean; safety?: Safety; current?: ClubMemberOperationalRead["memberships"][number];
  currentPresentation?: ReturnType<typeof membershipPresentation>; membershipDetails: Map<string, MembershipManagementDetail>;
  products: ClubProduct[]; locations: OrganisationLocation[]; household: Household; customers: Array<{ id: string; displayName: string }>;
  canManageHousehold: boolean; canChangeMembershipAccess: boolean; canManageMemberships: boolean; canRecordMembershipCash: boolean;
  canPerformInduction: boolean; canManageOrders: boolean; joinState?: JoinState; billingRows: BillingRow[];
  graceContexts: Map<string, GraceExtensionContext>; balance?: ClubBalanceAccount; memberOrders: ClubOrder[];
}) {
  const access = profile.access?.state ?? "unavailable";
  const benefits = uniqueMemberEntitlements(profile.entitlements);
  const accessAge = ({ under_18: "Under 18 · no 24-hour access", under_16: "Under 16 · restricted access", missing_date_of_birth: "Date of birth needs review", date_of_birth_conflict: "Date of birth conflict · review required" } as Record<string, string>)[safety?.ageState ?? ""];
  const inductionStatus = safety?.inductionRequired ? (safety.inductionState === "complete" ? "Complete" : safety.inductionState === "overdue" ? "Overdue" : safety.inductionState === "due" ? "Due · within grace" : safety.inductionState === "booked" ? "Booked" : "Required") : "Not required";
  const currentDetail = current ? membershipDetails.get(current.id) : undefined;
  const canRecordCashForCurrent = Boolean(current?.status === "active" && currentDetail && !currentDetail.is_lifetime && canRecordMembershipCash && ["owner", "gym_admin"].includes(memberRole));
  const paymentActivity = Boolean(joinState || billingRows.length || memberOrders.length || balance);
  const locationNames = new Map(locations.map(location => [location.id, location.name]));
  const locationsSummary = profile.access?.policy === "locations" ? (profile.access.permittedLocationIds ?? []).map(id => locationNames.get(id)).filter(Boolean).join(", ") : "";

  return <div className={`${styles.grid} club-profile-grid club-profile-polished club-profile-compact`}>
    <Surface className={`${styles.panel} ${styles.identity}`}>
      <div className={styles.panelHeading}><div><span className="eyebrow">MEMBER PROFILE</span><h2>Identity, contact &amp; access</h2></div>{editableProfile ? <ClubMemberProfileEditor organisationId={organisationId} profile={editableProfile} locations={locations} canEdit={canEditMemberContact && !editLoadFailed} /> : canEditMemberContact ? <p className="muted">Member details could not be loaded for editing.</p> : null}</div>
      <dl className={styles.facts}>
        <div><dt>Email</dt><dd>{profile.customer?.email ?? "Not recorded"}</dd></div>
        {contact?.phone || profile.customer?.phone ? <div><dt>Telephone</dt><dd>{contact?.phone ?? profile.customer?.phone}</dd></div> : null}
        {contact?.address_line_1 ? <div><dt>Address</dt><dd>{[contact.address_line_1, contact.address_line_2, contact.town_city, contact.postcode].filter(Boolean).join(", ")}</dd></div> : null}
        {editableProfile?.date_of_birth ? <div><dt>Date of birth</dt><dd>{formatClubDate(editableProfile.date_of_birth)}</dd></div> : null}
        <div><dt>Home gym</dt><dd>{profile.homeLocation?.name ?? "Not recorded"}<small>Preference only</small></dd></div>
        {emergency && (emergency.name || emergency.phone) ? <div><dt>Emergency contact</dt><dd>{[emergency.name, emergency.phone].filter(Boolean).join(" · ")}</dd></div> : null}
      </dl>
      <div className={styles.access}>
        <div><span className="eyebrow">CURRENT ACCESS</span><strong data-state={access}>{access === "active" ? "Access active" : access === "needs_attention" ? "Needs attention" : "Unavailable"}</strong>{profile.access?.reason ? <small>{accessReason(profile.access.reason)}</small> : null}</div>
        <div className={styles.accessFacts}>{accessAge ? <span>{accessAge}</span> : null}{safety?.inductionRequired ? <span>Induction · {inductionStatus}</span> : null}{safety?.twentyFourHourEligible === false ? <span>24-hour access · not eligible or needs review</span> : null}{profile.access?.policy === "locations" ? <span>{locationsSummary || "Selected locations"}</span> : profile.access?.policy === "future_locations" ? <span>All current and future locations</span> : null}</div>
      </div>
      {benefits.length ? <div className={styles.benefits}><span className="eyebrow">OTHER BENEFITS</span><div>{benefits.map(item => <span key={item.id}>{entitlementLabel(item.entitlementKey)}{item.allowance ? ` · ${item.allowance.quantity} per ${item.allowance.period}` : ""}{item.discount ? ` · ${item.discount.percent}% discount` : ""}</span>)}</div></div> : null}
      {customerId && safety ? <ClubMemberInductionCompletion organisationId={organisationId} customerId={customerId} bookingId={safety.inductionBooking?.id} startsAt={safety.inductionBooking?.startsAt} initialLocationId={safety.inductionBooking?.locationId ?? profile.induction?.state.booking?.locationId} locations={locations.filter(location => location.active).map(location => ({ id: location.id, name: location.name }))} canPerform={canPerformInduction} required={safety.inductionRequired === true} inductionState={safety.inductionState} /> : null}
    </Surface>

    <Surface className={`${styles.panel} ${styles.membership}`}>
      <div className={styles.panelHeading}><div><span className="eyebrow">CURRENT MEMBERSHIP</span><h2>{current ? currentPresentation?.name ?? current.productName ?? "Membership" : "No current membership"}</h2></div>{current ? <span className={styles.status}>{membershipLabel(current.status)}</span> : null}</div>
      {current ? <>
        <p className={styles.membershipDates}>Started {formatClubDate(current.startsAt)}{currentPresentation?.validity ? ` · ${currentPresentation.validity}` : current.endsAt ? ` · Paid through ${membershipPaidThroughDate(current.endsAt)}` : " · Lifetime / no expiry"}</p>
        <ClubMembershipHousehold organisationId={organisationId} membershipId={current.id} holders={household.map(holder => ({ customerId: holder.customerId, displayName: holder.displayName ?? "Member", billingContact: holder.billingContact === true, coverageRole: holder.coverageRole }))} candidates={customers} canManage={canManageHousehold} supportsAdditionalPerson={membershipSupportsAdditionalPerson(currentPresentation?.name)} />
        {canChangeMembershipAccess ? <ClubMembershipAccessStatus organisationId={organisationId} membershipId={current.id} status={current.status} /> : null}
        {currentDetail && customerId ? <ClubMembershipManager organisationId={organisationId} customerId={customerId} detail={currentDetail} products={products} locations={locations} canManage={canManageMemberships} canRecordCash={canRecordCashForCurrent} /> : current && canManageMemberships ? <p className="muted" role="status">Membership controls could not be loaded. Refresh or ask an administrator to check the Club database update.</p> : null}
        {canManageOrders ? <Link className={styles.orderLink} href={`/club/orders?org=${encodeURIComponent(organisationId)}&member=${encodeURIComponent(memberUserId)}`}>Create order for this member</Link> : null}
      </> : <p className={styles.emptyMembership}>{joinState ? `${joinState.product_name} · ${membershipLabel(joinState.status)}. Access has not been activated.` : "No membership is currently recorded."}</p>}
      {!current && ["gym_admin", "owner"].includes(memberRole) ? <ClubMembershipAssignment organisationId={organisationId} organisationSlug={organisationSlug} userId={memberUserId} products={products} /> : null}
    </Surface>

    {profile.memberships.length > (current ? 1 : 0) ? <Surface className={`${styles.panel} ${styles.history}`}><details><summary>Membership history <span>{profile.memberships.filter(item => item.id !== current?.id).length} records</span></summary><div>{profile.memberships.filter(item => item.id !== current?.id).map(item => <article key={item.id}><div><strong>{item.productName ?? "Membership"}</strong><span>{membershipLabel(item.status)} · {formatClubDate(item.startsAt)}{item.endsAt ? ` – ${membershipPaidThroughDate(item.endsAt)}` : " · No expiry recorded"}</span></div><small>Source · {item.source.replaceAll("_", " ")}</small></article>)}</div></details></Surface> : null}

    {paymentActivity ? <Surface className={`${styles.panel} ${styles.payments}`}><div className={styles.panelHeading}><div><span className="eyebrow">PAYMENTS &amp; PURCHASES</span><h2>Account activity</h2></div></div>
      {balance ? <div className="club-detail-row"><span>Madhouse Balance</span><strong>{money(balance.balanceMinor)}</strong></div> : null}
      {joinState ? <div className={styles.paymentBlock}><div className="club-detail-row"><span>Joining · {joinState.product_name}<small>{joinState.location_name ?? "Madhouse"} · Updated {new Date(joinState.updated_at).toLocaleDateString("en-GB")}</small></span><strong>{membershipLabel(joinState.status)}</strong></div>{joinState.product_name === "Concession Monthly" && !joinState.membership_id && canManageHousehold ? <ClubMembershipEligibility organisationId={organisationId} joinRequestId={joinState.id} /> : null}<div className="club-detail-row"><span>Initial payment<small>{joinState.upfront_amount_minor != null ? money(joinState.upfront_amount_minor) : "Amount unavailable"}</small></span><strong>{membershipLabel(joinState.upfront_payment_state ?? joinState.payment_state)}</strong></div>{joinState.checkout_kind === "monthly_recurring" ? <div className="club-detail-row"><span>Recurring payment authority</span><strong>{membershipLabel(joinState.recurring_authority_state ?? "required")}</strong></div> : null}</div> : null}
      {billingRows.length ? <div className={styles.paymentBlock}>{billingRows.map(row => { const provider = row.provider_type === "stripe" ? row.stripe_merchant_entity === "madhouse_franchise" ? "Stripe · Franchise" : "Stripe · route unverified" : row.provider_type === "gocardless" ? "GoCardless Direct Debit" : row.payment_method_family === "cash" ? "Cash arrangement" : "Payment provider unavailable"; const grace = graceContexts.get(row.id); return <div className="club-membership-row" key={row.id}><div className="club-detail-row"><span>{membershipLabel(row.state)}<small>{provider} · {row.provider_charge_date ? `Charge date ${new Date(row.provider_charge_date).toLocaleDateString("en-GB")}` : `Due ${new Date(row.next_due_at).toLocaleDateString("en-GB")}`} · Authority {membershipLabel(row.mandate_status ?? "pending")}{row.action_required_reason ? " · Action required" : ""}</small></span><strong>{money(row.amount_minor, row.currency)}</strong></div>{grace && (grace.eligible || grace.extensionCount > 0) ? <ClubMembershipGraceExtension organisationId={organisationId} context={grace} /> : null}</div>; })}</div> : null}
      {memberOrders.slice(0, 5).map(order => <div className="club-detail-row" key={order.id}><span>{order.items.map(item => item.productName).join(", ") || "Club order"}<small>{orderStateLabel(order.status)}</small></span><strong>{money(order.totalMinor, order.currency)}</strong></div>)}
    </Surface> : null}
  </div>;
}
