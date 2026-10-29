"use client";

import { useState, useTransition } from "react";
import { clubCapabilities, resolveClubCapabilities } from "@/lib/club-capabilities";
import { replaceStaffLocations, setCoachAccess, setStaffActive, setStaffPermission, setStaffRole } from "@/app/club/staff/actions";

type StaffRole = "owner" | "gym_staff" | "trainer" | "gym_admin";
type Override = { capability: string; decision: "allow" | "deny" };
type Group = { label: string; capabilities: readonly string[] };
const groups: Group[] = [
  { label: "Members & memberships", capabilities: ["members.view", "members.create", "members.link_account", "memberships.assign", "memberships.end_immediately"] },
  { label: "Payments & cash", capabilities: ["payments.take", "payments.record_cash", "payments.extend_grace", "refunds.issue", "refunds.approve", "cash.reconcile"] },
  { label: "Inventory & commerce", capabilities: ["inventory.adjust", "commerce.stock_remove", "supplier.catalogue_manage", "supplier.orders_manage", "supplier.receive", "commerce.pricing_manage", "commerce.collections_manage"] },
  { label: "Classes & services", capabilities: ["classes.manage", "services.manage"] },
  { label: "Administration", capabilities: ["staff.permissions_manage", "induction.manage_policy", "induction.perform", "members.import", "staff.work_submit", "staff.work_review"] },
  { label: "Finance", capabilities: ["finance.view", "finance.manage", "finance.export"] },
];
const capabilityLabels: Record<string, string> = {
  "members.view": "View members", "members.create": "Add members", "members.link_account": "Link member accounts",
  "memberships.assign": "Assign memberships", "memberships.end_immediately": "End memberships immediately",
  "payments.take": "Take payments", "payments.record_cash": "Record cash", "payments.extend_grace": "Extend payment grace", "refunds.issue": "Issue refunds",
  "refunds.approve": "Approve refunds", "cash.reconcile": "Reconcile cash", "inventory.adjust": "Adjust inventory",
  "commerce.stock_remove": "Remove or comp stock", "supplier.catalogue_manage": "Manage supplier catalogue",
  "supplier.orders_manage": "Manage supplier orders", "supplier.receive": "Receive supplier orders",
  "commerce.pricing_manage": "Manage commerce pricing", "commerce.collections_manage": "Manage collections",
  "classes.manage": "Manage classes", "services.manage": "Manage services", "staff.permissions_manage": "Manage staff permissions",
  "induction.manage_policy": "Manage induction policy", "induction.perform": "Perform inductions", "members.import": "Import members",
  "staff.work_submit": "Submit staff work", "staff.work_review": "Review staff work", "finance.view": "View finance",
  "finance.manage": "Manage finance", "finance.export": "Export finance",
};
const roleName = (role: StaffRole) => role === "owner" ? "Owner" : role === "gym_admin" ? "Manager" : role === "trainer" ? "PT / Coach" : "Operational Staff";

type Props = {
  organisationId: string;
  userId: string;
  name: string;
  email?: string;
  role: StaffRole;
  active: boolean;
  locationIds: string[];
  locations: Array<{ id: string; name: string }>;
  overrides: Override[];
  coachEnabled: boolean;
  gymMembership?: string;
};

export function ClubStaffManageAccess({ organisationId, userId, name, email, role: initialRole, active: initialActive, locationIds: initialLocations, locations, overrides: initialOverrides, coachEnabled: initialCoachEnabled, gymMembership }: Props) {
  const [role, setRole] = useState<StaffRole>(initialRole);
  const [savedRole, setSavedRole] = useState<StaffRole>(initialRole);
  const [active, setActive] = useState(initialActive);
  const [coachEnabled, setCoachEnabled] = useState(initialCoachEnabled);
  const [selected, setSelected] = useState(initialLocations);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const effective = resolveClubCapabilities(role, overrides);
  const roleDefaults = resolveClubCapabilities(role);
  const canEditRole = role !== "owner";
  const coachEligible = ["owner", "gym_admin", "trainer"].includes(role);
  const toggleLocation = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);

  const save = () => startTransition(async () => {
    if (canEditRole) {
      const roleResult = await setStaffRole({ organisationId, userId, role: role as Exclude<StaffRole, "owner"> });
      if (!roleResult.ok) return setMessage(roleResult.error);
      setSavedRole(role);
    }
    const locationResult = await replaceStaffLocations({ organisationId, userId, locationIds: selected });
    setMessage(locationResult.ok ? "Role and venue access saved." : locationResult.error);
  });
  const setPermission = (capability: string, enabled: boolean) => startTransition(async () => {
    const decision = enabled ? "allow" : "deny";
    const result = await setStaffPermission({ organisationId, userId, capability, decision });
    if (!result.ok) return setMessage(result.error);
    setOverrides(current => [...current.filter(item => item.capability !== capability), { capability, decision }]);
    setMessage("Permission exception saved.");
  });
  const changeCoach = () => startTransition(async () => {
    const result = await setCoachAccess({ organisationId, userId, active: !coachEnabled });
    if (!result.ok) return setMessage(result.error);
    setCoachEnabled(value => !value);
    setMessage("Coach access updated.");
  });
  const changeActive = () => startTransition(async () => {
    const result = await setStaffActive({ organisationId, userId, active: !active });
    if (!result.ok) return setMessage(result.error);
    setActive(value => !value);
    setMessage(active ? "Staff access suspended." : "Staff access reactivated.");
  });

  return <details className="staff-manage">
    <summary className="secondary staff-manage-trigger" aria-label={`Manage ${name}`}>Manage</summary>
    <div className="staff-manage-panel">
      <div className="staff-manage-heading"><div><span className="eyebrow">STAFF ACCESS</span><h3>{name}</h3><p className="muted">Role permissions are applied automatically. Use individual permissions only for exceptions.</p></div><span className={`staff-status ${active ? "is-active" : "is-suspended"}`}>{active ? "Active" : "Suspended"}</span></div>
      <div className="staff-manage-grid">
        <section className="staff-manage-section"><h4>Profile & access</h4><dl><div><dt>Email</dt><dd>{email || "No profile email"}</dd></div><div><dt>Role</dt><dd>{roleName(role)}{coachEnabled ? " · Coach/PT" : ""}</dd></div><div><dt>Gym membership</dt><dd>{gymMembership ?? "None"}</dd></div></dl>
          {canEditRole ? <label className="staff-field">Role<select value={role} onChange={event => setRole(event.target.value as Exclude<StaffRole, "owner">)}><option value="gym_admin">Manager</option><option value="gym_staff">Operational Staff</option><option value="trainer">PT / Coach</option></select></label> : <p className="muted">Owner access is protected and cannot be changed here.</p>}
        </section>
        <section className="staff-manage-section"><h4>Venues</h4>{role === "owner" ? <p className="muted">Organisation-wide access to all Club venues.</p> : <><p className="muted">Choose the Club locations this person can work at.</p><div className="staff-check-list">{locations.map(location => <label key={location.id}><input type="checkbox" checked={selected.includes(location.id)} disabled={pending} onChange={() => toggleLocation(location.id)} />{location.name}</label>)}</div><button className="secondary" type="button" disabled={pending} onClick={save}>Save role & venues</button></>}</section>
        <section className="staff-manage-section"><h4>Coach</h4><p className="muted">Coach access is managed separately from the Club role.</p>{coachEligible ? <div className="staff-inline-action"><span>{coachEnabled ? "Coach / PT enabled" : "Coach / PT disabled"}</span><button className="secondary" type="button" disabled={pending || !active || role !== savedRole} onClick={changeCoach}>{coachEnabled ? "Disable Coach access" : "Enable Coach access"}</button></div> : <p className="muted">Not available for this role.</p>}{role !== savedRole ? <small className="muted">Save the role change before updating Coach access.</small> : null}</section>
        <section className="staff-manage-section"><h4>Account status</h4><p className="muted">{active ? "This person can currently use their Club access." : "This person’s Club access is suspended."}</p>{role !== "owner" ? <button className={active ? "danger" : "secondary"} type="button" disabled={pending} onClick={changeActive}>{active ? "Suspend staff access" : "Reactivate staff access"}</button> : <p className="muted">The active Owner cannot be suspended from this page.</p>}</section>
      </div>
      <div className="staff-permissions"><div className="staff-permissions-heading"><div><h4>Permissions</h4><p className="muted">{effective.length} of {clubCapabilities.length} capabilities enabled for this account.</p></div></div>
        {groups.map(group => {
          const items = group.capabilities.filter(capability => clubCapabilities.includes(capability as never));
          const enabled = items.filter(capability => effective.includes(capability as never)).length;
          return <details className="staff-permission-group" key={group.label}><summary><span>{group.label}</span><small>{enabled} of {items.length} enabled</small></summary><div className="staff-permission-items">{items.map(capability => {
            const override = overrides.find(item => item.capability === capability);
            const roleDefault = roleDefaults.includes(capability as never);
            const ownerAutomatic = capability === "payments.extend_grace" && role === "owner";
            const state = ownerAutomatic ? "Automatic owner authority" : override ? override.decision === "allow" ? "Allowed by exception" : "Blocked by exception" : roleDefault ? "Role default" : "Not included in role";
            const disabled = ownerAutomatic || capability === "staff.permissions_manage" && role !== "owner" && role !== "gym_admin";
            return <label className="staff-permission-item" key={capability}><input type="checkbox" checked={effective.includes(capability as never)} disabled={pending || disabled} onChange={event => setPermission(capability, event.target.checked)} /><span><strong>{capabilityLabels[capability] ?? capability}</strong><small>{ownerAutomatic ? state : disabled ? "Not available for this role" : state}</small></span></label>;
          })}</div></details>;
        })}
      </div>
      {message ? <p className="staff-manage-message" role="status">{message}</p> : null}
    </div>
  </details>;
}
