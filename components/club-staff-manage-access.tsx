"use client";

import { useState, useTransition } from "react";
import { clubCapabilities, resolveClubCapabilities } from "@/lib/club-capabilities";
import { replaceStaffLocations, setStaffPermission, setStaffRole } from "@/app/club/staff/actions";

type Override = { capability: string; decision: "allow" | "deny" };
type Props = { organisationId: string; userId: string; role: "gym_staff" | "trainer" | "gym_admin"; locationIds: string[]; locations: Array<{ id: string; name: string }>; overrides: Override[] };

export function ClubStaffManageAccess({ organisationId, userId, role: initialRole, locationIds: initialLocations, locations, overrides: initialOverrides }: Props) {
  const [role, setRole] = useState<Props["role"]>(initialRole);
  const [selected, setSelected] = useState(initialLocations);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const effective = resolveClubCapabilities(role, overrides);
  const toggleLocation = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);

  const save = () => startTransition(async () => {
    const roleResult = await setStaffRole({ organisationId, userId, role });
    if (!roleResult.ok) return setMessage(roleResult.error);
    const locationResult = await replaceStaffLocations({ organisationId, userId, locationIds: selected });
    setMessage(locationResult.ok ? "Access updated." : locationResult.error);
  });

  const setPermission = (capability: string, enabled: boolean) => startTransition(async () => {
    const decision = enabled ? "allow" : "deny";
    const result = await setStaffPermission({ organisationId, userId, capability, decision });
    if (!result.ok) return setMessage(result.error);
    setOverrides(current => [...current.filter(item => item.capability !== capability), { capability, decision }]);
    setMessage("Permission updated.");
  });

  return <details className="staff-access-editor"><summary>Manage access</summary><div className="staff-access-editor-body">
    <label>Role<select value={role} onChange={event => setRole(event.target.value as Props["role"])}><option value="gym_staff">Staff</option><option value="trainer">Trainer</option><option value="gym_admin">Manager</option></select></label>
    <fieldset><legend>Authorised locations</legend>{locations.map(location => <label key={location.id}><input type="checkbox" checked={selected.includes(location.id)} onChange={() => toggleLocation(location.id)} />{location.name}</label>)}</fieldset>
    <button className="primary" type="button" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save role and locations"}</button>
    <details><summary>Individual permissions ({effective.length} enabled)</summary><fieldset><legend>Override this role’s standard package</legend>{clubCapabilities.map(capability => {
      const managementOnly = capability === "staff.permissions_manage";
      const disabled = managementOnly && role !== "gym_admin";
      return <label key={capability}><input type="checkbox" checked={effective.includes(capability)} disabled={pending || disabled} onChange={event => setPermission(capability, event.target.checked)} />{capability.replace(/[._]/g, " ")}{disabled ? " (management only)" : ""}</label>;
    })}</fieldset></details>
    {message ? <p className="muted" role="status">{message}</p> : null}
  </div></details>;
}
