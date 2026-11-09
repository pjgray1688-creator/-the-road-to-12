"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStaffAccessGrant } from "@/app/club/staff/actions";
import { resolveClubCapabilities } from "@/lib/club-capabilities";
import styles from "./club-staff-management.module.css";

type StaffRole = "gym_staff" | "gym_admin" | "trainer";
const DEFAULT_ROLE: StaffRole = "gym_admin";

export function ClubStaffAccessForm({ organisationId, locations }: { organisationId: string; locations: Array<{ id: string; name: string }> }) {
  const [role, setRole] = useState<StaffRole>(DEFAULT_ROLE);
  const [coachRequested, setCoachRequested] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  const coachEligible = role === "gym_admin" || role === "trainer";

  return <details ref={detailsRef} className="staff-add" onToggle={event => {
    if (event.currentTarget.open) setMessage(undefined);
  }}><summary className={`primary staff-add-trigger ${styles.addTrigger}`}><span aria-hidden="true">+</span> Add staff member</summary><form ref={formRef} className={`staff-access-form ${styles.accessForm}`} onSubmit={event => {
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
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      formRef.current?.reset();
      setRole(DEFAULT_ROLE);
      setCoachRequested(false);
      setMessage(undefined);
      if (detailsRef.current) detailsRef.current.open = false;
      router.refresh();
    });
  }}>
    <p className={`muted ${styles.formIntro}`}>Invite someone into Club. This does not create a gym membership.</p>
    <label className={styles.fieldLabel}>Name<input name="displayName" autoComplete="name" required /></label>
    <label className={styles.fieldLabel}>Email<input name="email" type="email" autoComplete="email" required /></label>
    <label className={styles.fieldLabel}>Staff role<select value={role} onChange={event => {
      const nextRole = event.target.value as StaffRole;
      setRole(nextRole);
      if (nextRole === "trainer") setCoachRequested(true);
      if (nextRole === "gym_staff") setCoachRequested(false);
    }}><option value="gym_admin">Manager</option><option value="gym_staff">Operational Staff</option><option value="trainer">PT / Coach</option></select></label>
    <fieldset className={styles.venueFieldset}><legend>Venue access</legend>{locations.map(location => <label className={styles.checkLabel} key={location.id}><input type="checkbox" name="locationIds" value={location.id} />{location.name}</label>)}</fieldset>
    {coachEligible ? <label className={`staff-form-check ${styles.checkLabel}`}><input type="checkbox" checked={coachRequested} onChange={event => setCoachRequested(event.target.checked)} />Enable Coach/PT access when this person accepts</label> : <p className={`muted ${styles.formNote}`}>Coach access is not available for Operational Staff.</p>}
    <label className={`staff-form-check ${styles.checkLabel}`}><input type="checkbox" name="memberIntent" />This person is also a gym member</label>
    <p className={`muted ${styles.formNote}`}>This is an information note only. Gym membership is set up separately. The {role === "gym_admin" ? "Manager" : role === "trainer" ? "PT / Coach" : "Operational Staff"} role includes {resolveClubCapabilities(role).length} standard permissions.</p>
    <button className="primary" disabled={pending}>{pending ? "Sending…" : "Send staff invite"}</button>
    {message ? <p role="alert" className={styles.formMessage}>{message}</p> : null}
  </form></details>;
}
