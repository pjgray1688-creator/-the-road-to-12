"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStaffAccessGrant } from "@/app/club/staff/actions";
import { resolveClubCapabilities } from "@/lib/club-capabilities";

type StaffRole = "gym_staff" | "gym_admin" | "trainer";

export function ClubStaffAccessForm({ organisationId, locations }: { organisationId: string; locations: Array<{ id: string; name: string }> }) {
  const [role, setRole] = useState<StaffRole>("gym_admin");
  const [coachRequested, setCoachRequested] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const coachEligible = role === "gym_admin" || role === "trainer";

  return <details className="staff-add"><summary className="primary staff-add-trigger"><span aria-hidden="true">＋</span> Add staff member</summary><form className="staff-access-form" onSubmit={event => {
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
        ? "Invitation prepared. The person will appear in Pending invitations once the page refreshes."
        : result.error);
      if (result.ok) router.refresh();
    });
  }}>
    <p className="muted">Invite someone into Club. This does not create a gym membership.</p>
    <label>Name<input name="displayName" autoComplete="name" required /></label>
    <label>Email<input name="email" type="email" autoComplete="email" required /></label>
    <label>Staff role<select value={role} onChange={event => {
      const nextRole = event.target.value as StaffRole;
      setRole(nextRole);
      if (nextRole === "trainer") setCoachRequested(true);
      if (nextRole === "gym_staff") setCoachRequested(false);
    }}><option value="gym_admin">Manager</option><option value="gym_staff">Operational Staff</option><option value="trainer">PT / Coach</option></select></label>
    <fieldset><legend>Venue access</legend>{locations.map(location => <label key={location.id}><input type="checkbox" name="locationIds" value={location.id} />{location.name}</label>)}</fieldset>
    {coachEligible ? <label className="staff-form-check"><input type="checkbox" checked={coachRequested} onChange={event => setCoachRequested(event.target.checked)} />Enable Coach/PT access when this person accepts</label> : <p className="muted">Coach access is not available for Operational Staff.</p>}
    <label className="staff-form-check"><input type="checkbox" name="memberIntent" />This person is also a gym member</label>
    <p className="muted">This is an information note only. Gym membership is set up separately. The {role === "gym_admin" ? "Manager" : role === "trainer" ? "PT / Coach" : "Operational Staff"} role includes {resolveClubCapabilities(role).length} standard permissions.</p>
    <button className="primary" disabled={pending}>{pending ? "Sending…" : "Send staff invite"}</button>
    {message ? <p role="status" className="muted">{message}</p> : null}
  </form></details>;
}
