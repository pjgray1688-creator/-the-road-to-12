import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { resolveClubCapabilities } from "@/lib/club-capabilities";
import { ClubStaffAccessForm } from "@/components/club-staff-access-form";
import { linkOperationalStaffInvitation, resendStaffInvitation, revokeStaffAccessGrant } from "@/app/club/staff/actions";
import { ClubStaffManageAccess } from "@/components/club-staff-manage-access";
import { ClubOwnerTransfer } from "@/components/club-owner-transfer";

const roleLabel = (role: string) => role === "owner" ? "Owner" : role === "gym_admin" ? "Manager" : role === "trainer" ? "PT / Coach" : "Operational Staff";
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "R12";
const invitationLabel = (state: string, failure: unknown, expiresAt: string) => {
  if (state === "sent") return "Sent · waiting for acceptance";
  if (state === "failed" || failure) return "Delivery failed · resend available";
  if (state === "cancelled") return "Cancelled";
  if (state === "processing") return "Sending";
  if (state === "unavailable") return "Delivery unavailable";
  if (state === "scheduled") return "Scheduled";
  if (new Date(expiresAt).getTime() < Date.now()) return "Expired";
  return "Waiting to send";
};

type StaffAccountRow = {
  member_id: string;
  user_id: string;
  display_name: string;
  email?: string;
  role: "owner" | "gym_admin" | "gym_staff" | "trainer";
  active: boolean;
  is_gym_member: boolean;
  membership_name?: string;
};

export default async function ClubStaffPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOperationalContext(supabase, user.id, (await searchParams)?.org);
  const canManageStaff = context ? await context.repository.hasCapability(context.organisation.id, user.id, "staff.permissions_manage") : false;
  if (!context || !canManageStaff) return <AppShell className="module-page club-page"><PageHeader title="Staff" description="Staff management is restricted to organisation managers." /><EmptyState title="Management access required">Ask an owner or manager to review your Club permissions.</EmptyState><AppNav /></AppShell>;

  const [locations, staffResult, pendingResult, locationResult, overrideResult, coachResult, invitationResult, operationalAssignmentsResult] = await Promise.all([
    context.repository.listLocations(context.organisation.id),
    supabase.rpc("club_list_staff_accounts", { p_organisation_id: context.organisation.id }),
    supabase.from("club_staff_access_grants").select("id,email_normalized,display_name,intended_role,status,location_ids,coach_requested,member_intent,created_at,expires_at").eq("organisation_id", context.organisation.id).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("club_staff_location_access").select("user_id,location_id").eq("organisation_id", context.organisation.id),
    supabase.from("club_staff_permission_overrides").select("user_id,capability,decision").eq("organisation_id", context.organisation.id),
    supabase.rpc("coach_list_permissions", { p_organisation_id: context.organisation.id }),
    supabase.rpc("club_list_staff_invitation_notifications", { p_organisation_id: context.organisation.id }),
    supabase.rpc("club_madhouse_list_staff_assignments", { p_organisation_id: context.organisation.id }),
  ]);
  const staff = (Array.isArray(staffResult.data) ? staffResult.data : []) as StaffAccountRow[];
  const pendingRows = Array.isArray(pendingResult.data) ? pendingResult.data : [];
  const locationRows = Array.isArray(locationResult.data) ? locationResult.data : [];
  const overrideRows = Array.isArray(overrideResult.data) ? overrideResult.data : [];
  const coachRows = Array.isArray(coachResult.data) ? coachResult.data : [];
  const invitationRows = Array.isArray(invitationResult.data) ? invitationResult.data : [];
  const operationalAssignments = Array.isArray(operationalAssignmentsResult.data) ? operationalAssignmentsResult.data : [];
  const invitationStatus = new Map(invitationRows.map(row => [String(row.grant_id), row]));
  const locationNames = new Map(locations.map(location => [location.id, location.name]));
  const staffLocations = new Map<string, string[]>();
  for (const row of locationRows) {
    const key = String(row.user_id);
    staffLocations.set(key, [...(staffLocations.get(key) ?? []), String(row.location_id)]);
  }
  const staffOverrides = new Map<string, Array<{ capability: string; decision: "allow" | "deny" }>>();
  for (const row of overrideRows) {
    const key = String(row.user_id);
    staffOverrides.set(key, [...(staffOverrides.get(key) ?? []), { capability: String(row.capability), decision: row.decision === "deny" ? "deny" : "allow" }]);
  }
  const coachAccess = new Map<string, boolean>(coachRows.map(row => [String(row.user_id), Boolean(row.active)]));
  const ownCapabilities = resolveClubCapabilities(context.role);
  const activeStaff = staff.filter(person => person.active);
  const suspendedStaff = staff.filter(person => !person.active);

  return <AppShell className="module-page club-page staff-management-page">
    <PageHeader title="Staff" description="Manage staff access, roles and permissions." />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <div className="staff-page-actions"><ClubStaffAccessForm organisationId={context.organisation.id} locations={locations} /><Link className="secondary staff-email-link" href={`/club/staff/email-preview?org=${encodeURIComponent(context.organisation.id)}`}>Email preview / test</Link></div>

    <Surface>
      <div className="staff-section-heading"><div><span className="eyebrow">TEAM</span><h2>Active staff</h2></div><span className="staff-count">{activeStaff.length} active</span></div>
      {activeStaff.length ? <div className="staff-list">{activeStaff.map(member => {
        const overrides = staffOverrides.get(member.user_id) ?? [];
        const coachEnabled = coachAccess.get(member.user_id) === true;
        const memberLocations = (staffLocations.get(member.user_id) ?? []).map(id => locationNames.get(id)).filter(Boolean) as string[];
        const venueSummary = member.role === "owner" ? "Organisation-wide" : memberLocations.join(" + ") || "No venues assigned";
        return <article className="staff-person" key={member.member_id}>
          <div className="staff-person-avatar" aria-hidden="true">{initials(member.display_name)}</div>
          <div className="staff-person-main"><strong>{member.display_name}</strong><span>{member.email ?? "No profile email"}</span></div>
          <div className="staff-person-access"><strong>{roleLabel(member.role)}</strong>{coachEnabled ? <span className="staff-badge">Coach / PT</span> : null}<small>{venueSummary}</small></div>
          <span className={`staff-status ${member.active ? "is-active" : "is-suspended"}`}>{member.active ? "Active" : "Suspended"}</span>
          <ClubStaffManageAccess organisationId={context.organisation.id} userId={member.user_id} name={member.display_name} email={member.email} role={member.role} active={member.active} locationIds={staffLocations.get(member.user_id) ?? []} locations={locations} overrides={overrides} coachEnabled={coachEnabled} gymMembership={member.is_gym_member ? member.membership_name ?? "Active" : "None"} />
        </article>;
      })}</div> : <EmptyState title="No staff accounts yet">Send an invitation to give a team member Club access.</EmptyState>}
      {suspendedStaff.length ? <details className="staff-suspended-list"><summary>Suspended access <small>{suspendedStaff.length}</small></summary><div className="staff-list">{suspendedStaff.map(member => <article className="staff-person" key={member.member_id}><div className="staff-person-avatar" aria-hidden="true">{initials(member.display_name)}</div><div className="staff-person-main"><strong>{member.display_name}</strong><span>{member.email ?? "No profile email"}</span></div><div className="staff-person-access"><strong>{roleLabel(member.role)}</strong><small>{(staffLocations.get(member.user_id) ?? []).map(id => locationNames.get(id)).filter(Boolean).join(" + ") || "No venues assigned"}</small></div><span className="staff-status is-suspended">Suspended</span><ClubStaffManageAccess organisationId={context.organisation.id} userId={member.user_id} name={member.display_name} email={member.email} role={member.role} active={member.active} locationIds={staffLocations.get(member.user_id) ?? []} locations={locations} overrides={staffOverrides.get(member.user_id) ?? []} coachEnabled={coachAccess.get(member.user_id) === true} gymMembership={member.is_gym_member ? member.membership_name ?? "Active" : "None"} /></article>)}</div></details> : null}
    </Surface>

    {operationalAssignments.length ? <Surface>
      <div className="staff-section-heading"><div><span className="eyebrow">MADHOUSE ROTA & CLASSES</span><h2>Prepared staff identities</h2><p className="muted">These operational assignments do not grant system access. Link the verified invitation to reconcile future classes and shifts after acceptance.</p></div></div>
      <div className="staff-list">{operationalAssignments.map(row => {
        const assignmentId = String(row.assignment_id);
        const name = String(row.canonical_name);
        const locationsForAssignment = Array.isArray(row.location_ids) ? row.location_ids.map((id: unknown) => locationNames.get(String(id))).filter(Boolean).join(" + ") : "";
        const candidates = pendingRows.filter(grant => String(grant.display_name ?? "").trim().split(/\s+/)[0]?.toLowerCase() === name.toLowerCase());
        return <article className="staff-invite" key={assignmentId}><div className="staff-invite-main"><strong>{name}</strong><span>{locationsForAssignment || "No locations"}</span><small>{row.grant_status ? `Invitation ${String(row.grant_status)}` : "No invitation linked"}</small></div>{candidates.length ? <form className="staff-invite-actions" action={async (formData: FormData) => { "use server"; const grantId = String(formData.get("grantId") ?? ""); if (grantId) await linkOperationalStaffInvitation({ organisationId: context.organisation.id, assignmentId, grantId }); }}><select name="grantId" aria-label={`Invitation for ${name}`} defaultValue=""><option value="" disabled>Choose matching invite</option>{candidates.map(grant => <option key={String(grant.id)} value={String(grant.id)}>{String(grant.email_normalized)}</option>)}</select><button className="secondary" type="submit">Link invitation</button></form> : null}</article>;
      })}</div>
    </Surface> : null}

    <Surface>
      <div className="staff-section-heading"><div><span className="eyebrow">INVITATIONS</span><h2>Pending invitations</h2><p className="muted">Invites are separate from active staff access.</p></div><span className="staff-count">{pendingRows.length} waiting</span></div>
      {pendingRows.length ? <div className="staff-list staff-pending-list">{pendingRows.map(row => {
        const venueList = Array.isArray(row.location_ids) ? row.location_ids.map(id => locationNames.get(String(id)) ?? "Unknown venue").join(" + ") || "All venues" : "Venues not set";
        const notification = invitationStatus.get(String(row.id));
        const state = invitationLabel(String(notification?.state ?? "pending"), notification?.failure_code, String(row.expires_at));
        return <article className="staff-invite" key={String(row.id)}><div className="staff-invite-avatar" aria-hidden="true">{initials(String(row.display_name ?? "Staff member"))}</div><div className="staff-invite-main"><strong>{String(row.display_name ?? "Staff member")}</strong><span>{String(row.email_normalized)}</span><small>{roleLabel(String(row.intended_role))}{row.coach_requested ? " · Coach/PT" : ""} · {venueList}</small></div><div className="staff-invite-meta"><span className={`staff-invite-state ${state.startsWith("Delivery failed") || state === "Expired" ? "needs-attention" : ""}`}>{state}</span><small>Expires {new Date(String(row.expires_at)).toLocaleDateString("en-GB")}</small></div><div className="staff-invite-actions"><form action={async () => { "use server"; await resendStaffInvitation(context.organisation.id, String(row.id)); }}><button className="secondary" type="submit">Resend invitation</button></form><form action={async () => { "use server"; await revokeStaffAccessGrant(context.organisation.id, String(row.id)); }}><button className="secondary" type="submit">Cancel invitation</button></form></div></article>;
      })}</div> : <p className="staff-empty-note">No invitations are waiting for acceptance.</p>}
      <p className="staff-footnote">Invitees use their own R12 account and the invited email address. Gym membership is handled separately.</p>
    </Surface>

    <details className="staff-own-permissions"><summary>View my permissions <small>{ownCapabilities.length} enabled</small></summary><div className="permission-groups">{ownCapabilities.map(capability => <span key={capability}>{capability.replace(/[._]/g, " ")}</span>)}</div><p className="staff-footnote">Your role supplies a standard permission package. Server checks remain authoritative.</p></details>
    {context.role === "owner" ? <details className="staff-owner-control"><summary><span><span className="eyebrow">OWNER ONLY</span><strong>Organisation ownership</strong></span><small>Protected change</small></summary><div className="staff-owner-body"><p className="staff-current-owner"><strong>Current Owner</strong><span>{staff.find(person => person.role === "owner")?.display_name ?? "You"}</span></p><p className="muted">Transfer ownership only when your launch checks are complete. The new Owner receives protected Owner authority; your account becomes Manager. Coach access, venue access and memberships remain unchanged.</p><ClubOwnerTransfer organisationId={context.organisation.id} candidates={staff.filter(person => person.active && person.role !== "owner").map(person => ({ userId: person.user_id, name: person.display_name, role: roleLabel(person.role) }))} /></div></details> : null}
    <BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to overview</BackButton>
    <AppNav />
  </AppShell>;
}
