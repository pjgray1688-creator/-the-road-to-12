import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { resolveClubCapabilities } from "@/lib/club-capabilities";
import { ClubStaffAccessForm } from "@/components/club-staff-access-form";
import { revokeStaffAccessGrant, setCoachAccess, setStaffActive } from "@/app/club/staff/actions";
import { ClubStaffManageAccess } from "@/components/club-staff-manage-access";

const groups = [
  { label: "Members & memberships", match: ["members.", "memberships."] },
  { label: "Payments & cash", match: ["payments.", "cash.", "refunds."] },
  { label: "Inventory", match: ["inventory.", "commerce.stock_"] },
  { label: "Classes & services", match: ["classes.", "services."] },
  { label: "Administration", match: ["staff.", "induction."] },
];
const humanCapability = (value: string) => ({
  "members.view": "View members", "members.create": "Add members", "memberships.assign": "Assign memberships",
  "payments.record_cash": "Record cash", "cash.reconcile": "Reconcile cash", "inventory.adjust": "Adjust stock",
  "commerce.stock_remove": "Remove/comp stock", "classes.manage": "Manage classes", "services.manage": "Manage services",
  "induction.manage_policy": "Manage induction policy", "induction.perform": "Perform inductions",
  "staff.permissions_manage": "Manage staff permissions",
} as Record<string, string>)[value] ?? value.replace(/[._]/g, " ");
const roleLabel = (role: string) => role === "owner" ? "Owner" : role === "gym_admin" ? "Manager" : role === "trainer" ? "PT" : "Operational Staff";

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

  const [locations, staffResult, pendingResult, locationResult, overrideResult, coachResult] = await Promise.all([
    context.repository.listLocations(context.organisation.id),
    supabase.rpc("club_list_staff_accounts", { p_organisation_id: context.organisation.id }),
    supabase.from("club_staff_access_grants").select("id,email_normalized,display_name,intended_role,status,location_ids,coach_requested,member_intent,created_at,expires_at").eq("organisation_id", context.organisation.id).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("club_staff_location_access").select("user_id,location_id").eq("organisation_id", context.organisation.id),
    supabase.from("club_staff_permission_overrides").select("user_id,capability,decision").eq("organisation_id", context.organisation.id),
    supabase.rpc("coach_list_permissions", { p_organisation_id: context.organisation.id }),
  ]);
  const staff = (Array.isArray(staffResult.data) ? staffResult.data : []) as StaffAccountRow[];
  const pendingRows = Array.isArray(pendingResult.data) ? pendingResult.data : [];
  const locationRows = Array.isArray(locationResult.data) ? locationResult.data : [];
  const overrideRows = Array.isArray(overrideResult.data) ? overrideResult.data : [];
  const coachRows = Array.isArray(coachResult.data) ? coachResult.data : [];
  const locationNames = new Map(locations.map(location => [location.id, location.name]));
  const staffLocations = new Map<string, string[]>();
  for (const row of locationRows) {
    const key = String(row.user_id);
    staffLocations.set(key, [...(staffLocations.get(key) ?? []), locationNames.get(String(row.location_id)) ?? "Unknown venue"]);
  }
  const staffOverrides = new Map<string, Array<{ capability: string; decision: "allow" | "deny" }>>();
  for (const row of overrideRows) {
    const key = String(row.user_id);
    staffOverrides.set(key, [...(staffOverrides.get(key) ?? []), {
      capability: String(row.capability),
      decision: row.decision === "deny" ? "deny" : "allow",
    }]);
  }
  const coachAccess = new Map<string, boolean>(coachRows.map(row => [String(row.user_id), Boolean(row.active)]));

  return <AppShell className="module-page club-page">
    <PageHeader eyebrow="R12 CLUB · STAFF" title="Staff" description="Prepare personal staff access, then manage each authenticated account." />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <ClubStaffAccessForm organisationId={context.organisation.id} locations={locations} />
    <Surface>
      <div className="section-header"><div><span className="eyebrow">STAFF ACCOUNTS</span><h2>People with Club access</h2></div></div>
      {staff.length ? staff.map(member => {
        const overrides = staffOverrides.get(member.user_id) ?? [];
        const capabilities = resolveClubCapabilities(member.role, overrides);
        const coachEnabled = coachAccess.get(member.user_id) === true;
        const coachEligible = ["trainer", "gym_admin", "owner"].includes(member.role);
        const memberLocations = staffLocations.get(member.user_id) ?? [];
        return <div className="club-detail-row staff-row" key={member.member_id}>
          <div><strong>{member.display_name}</strong><span className="muted">{member.email ?? "No profile email"} · {roleLabel(member.role)}</span><span className="muted">{member.active ? "Active" : "Suspended"} · {member.user_id === user.id ? "You" : "Personal R12 account"} · {memberLocations.join(", ") || "Organisation-wide"}</span><span className="muted">Gym membership: {member.is_gym_member ? member.membership_name ?? "Active" : "None"}</span></div>
          <span className="muted">{capabilities.length} effective permissions</span>
          <div className="staff-coach-access"><strong>Coach/PT: {coachEligible ? coachEnabled ? "Enabled" : "Disabled" : "Not eligible"}</strong>{coachEligible && member.active ? <form action={async () => { "use server"; await setCoachAccess({ organisationId: context.organisation.id, userId: member.user_id, active: !coachEnabled }); }}><button className="secondary" type="submit">{coachEnabled ? "Disable Coach access" : "Enable Coach access"}</button></form> : null}</div>
          {member.role !== "owner" ? <>
            {member.active ? <ClubStaffManageAccess organisationId={context.organisation.id} userId={member.user_id} role={member.role} locationIds={locationRows.filter(row => String(row.user_id) === member.user_id).map(row => String(row.location_id))} locations={locations} overrides={overrides} /> : null}
            <form action={async () => { "use server"; await setStaffActive({ organisationId: context.organisation.id, userId: member.user_id, active: !member.active }); }}><button className="secondary" type="submit">{member.active ? "Suspend staff access" : "Reactivate staff access"}</button></form>
          </> : null}
        </div>;
      }) : <p className="muted">No staff accounts are configured.</p>}
    </Surface>
    <Surface>
      <div className="section-header"><div><span className="eyebrow">PENDING ACCESS</span><h2>Waiting for account acceptance</h2></div></div>
      {pendingRows.length ? pendingRows.map(row => <div className="club-detail-row" key={String(row.id)}>
        <div><strong>{String(row.display_name ?? "Staff member")} · {String(row.email_normalized)}</strong><span className="muted">{roleLabel(String(row.intended_role))} · Coach/PT {row.coach_requested ? "will be enabled" : "not requested"} · Gym member {row.member_intent ? "expected separately" : "not expected"}</span><span className="muted">{Array.isArray(row.location_ids) ? row.location_ids.map(id => locationNames.get(String(id)) ?? "Unknown venue").join(", ") || "All venues" : "Venues not set"} · Expires {new Date(String(row.expires_at)).toLocaleDateString("en-GB")}</span></div>
        <form action={async () => { "use server"; await revokeStaffAccessGrant(context.organisation.id, String(row.id)); }}><button className="secondary" type="submit">Cancel invitation</button></form>
      </div>) : <p className="muted">No pending staff access.</p>}
      <p className="muted">The staff member uses <Link href="/account?mode=signUp&next=%2Fclub%2Fstaff%2Fclaim">Create or accept staff access</Link> with the invited email. Managers never set or see their password.</p>
    </Surface>
    <Surface><span className="eyebrow">YOUR PERMISSIONS</span><p className="muted">Grouped for quick review. Security remains enforced by the server.</p><div className="permission-groups">{groups.map(group => { const capabilities = resolveClubCapabilities(context.role); const items = capabilities.filter(capability => group.match.some(prefix => capability.startsWith(prefix))); return <div className="permission-group" key={group.label}><strong>{group.label}</strong><span>{items.length ? items.map(humanCapability).join(" · ") : "None enabled"}</span></div>; })}</div></Surface>
    <BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to overview</BackButton>
    <AppNav />
  </AppShell>;
}
