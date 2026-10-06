"use client";

import { useState, useTransition } from "react";
import { createStaffAccessGrant } from "@/app/club/staff/actions";
import { resolveClubCapabilities } from "@/lib/club-capabilities";

type StaffRole = "gym_staff" | "gym_admin" | "trainer";

export function ClubStaffAccessForm({ organisationId, locations }: { organisationId: string; locations: Array<{ id: string; name: string }> }) {
  const [role, setRole] = useState<StaffRole>("gym_staff");
  const [coachRequested, setCoachRequested] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const coachEligible = role === "gym_admin" || role === "trainer";

  return <form className="staff-access-form" onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createStaffAccessGrant({
        organisationId,
        email: String(form.get("email") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        role,
        locationIds: form.getAll("locationIds").map(String),
        coachRequested: coachEligible && coachRequested,
        memberIntent: form.get("memberIntent") === "on",
      });
      setMessage(result.ok
        ? "Access prepared. Ask them to create or sign into their own R12 account with this email, then open Club staff access to accept."
        : result.error);
    });
  }}>
    <span className="eyebrow">ADD STAFF MEMBER</span>
    <label>Name<input name="displayName" autoComplete="name" required /></label>
    <label>Email<input name="email" type="email" autoComplete="email" required /></label>
    <label>Staff role<select value={role} onChange={event => {
      const nextRole = event.target.value as StaffRole;
      setRole(nextRole);
      if (nextRole === "gym_staff") setCoachRequested(false);
    }}><option value="gym_admin">Manager</option><option value="gym_staff">Operational Staff</option><option value="trainer">PT</option></select></label>
    <fieldset><legend>Venue access</legend>{locations.map(location => <label key={location.id}><input type="checkbox" name="locationIds" value={location.id} />{location.name}</label>)}</fieldset>
    <label><input type="checkbox" checked={coachRequested} disabled={!coachEligible} onChange={event => setCoachRequested(event.target.checked)} />Enable Coach/PT access when this person accepts</label>
    {!coachEligible ? <p className="muted">Coach access is available to Managers and PTs, and is always granted explicitly.</p> : null}
    <label><input type="checkbox" name="memberIntent" />Also a gym member</label>
    <p className="muted">This is a note only. Gym membership is created separately after staff access is active.</p>
    <p className="muted">{resolveClubCapabilities(role).length} permissions are included in the standard {role === "gym_admin" ? "management" : "operational"} package.</p>
    <button className="primary" disabled={pending}>{pending ? "Preparing…" : "Prepare staff access"}</button>
    {message ? <p role="status" className="muted">{message}</p> : null}
  </form>;
}
