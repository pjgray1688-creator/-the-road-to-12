"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClubCustomerProfileAction } from "@/app/club/members/actions";
import type { OrganisationLocation } from "@/lib/club";
import styles from "./club-member-management.module.css";

export type EditableCustomerProfile = {
  id: string; display_name: string; email?: string | null; phone?: string | null;
  address_line_1?: string | null; address_line_2?: string | null; town_city?: string | null;
  postcode?: string | null; date_of_birth?: string | null; preferred_location_id?: string | null;
};

export function ClubMemberProfileEditor({ organisationId, profile, locations, canEdit }: { organisationId: string; profile: EditableCustomerProfile; locations: OrganisationLocation[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  if (!canEdit) return null;
  const dateValue = (value?: string | null) => value ? value.slice(0, 10) : "";
  function submit(form: FormData) {
    if (!window.confirm("Save these member details? This will not change their R12 sign-in email or verify their identity.")) return;
    setMessage("");
    startTransition(async () => {
      const result = await updateClubCustomerProfileAction({
        organisationId, customerId: profile.id,
        displayName: String(form.get("displayName") ?? ""), email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""), addressLine1: String(form.get("addressLine1") ?? ""),
        addressLine2: String(form.get("addressLine2") ?? ""), townCity: String(form.get("townCity") ?? ""),
        postcode: String(form.get("postcode") ?? ""), dateOfBirth: String(form.get("dateOfBirth") ?? ""),
        homeLocationId: String(form.get("homeLocationId") ?? ""), reason: String(form.get("reason") ?? ""),
      });
      if (!result.ok) { setMessage(result.error); return; }
      setMessage("Member details saved."); setOpen(false); router.refresh();
    });
  }
  return <section className={styles.editor}>
    {!open ? <button className="secondary" type="button" onClick={() => { setMessage(""); setOpen(true); }}>Edit member details</button> : null}
    {open ? <form action={submit} className={styles.editor}>
      <label>Full name<input name="displayName" required maxLength={160} defaultValue={profile.display_name} /></label>
      <label>Contact email<input name="email" type="email" maxLength={254} defaultValue={profile.email ?? ""} /></label>
      <p className="muted">Contact email is for gym communications only. It does not change the R12 sign-in or link an account.</p>
      <label>Telephone<input name="phone" type="tel" maxLength={40} defaultValue={profile.phone ?? ""} /></label>
      <label>Address line 1<input name="addressLine1" maxLength={160} defaultValue={profile.address_line_1 ?? ""} /></label>
      <label>Address line 2<input name="addressLine2" maxLength={160} defaultValue={profile.address_line_2 ?? ""} /></label>
      <label>Town or city<input name="townCity" maxLength={100} defaultValue={profile.town_city ?? ""} /></label>
      <label>Postcode<input name="postcode" maxLength={20} autoCapitalize="characters" defaultValue={profile.postcode ?? ""} /></label>
      <label>Date of birth on member record<input name="dateOfBirth" type="date" defaultValue={dateValue(profile.date_of_birth)} /></label>
      <p className="muted">This records the member’s stated date of birth. It does not verify identity or change Glow Zone age checks.</p>
      <label>Home gym<select name="homeLocationId" defaultValue={profile.preferred_location_id ?? ""}><option value="">Not recorded</option>{locations.filter(location => location.active).map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
      <label>Reason for change<textarea name="reason" required minLength={3} maxLength={500} /></label>
      <div className={styles.actions}><button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save details"}</button><button className="secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </form> : null}
    {message ? <p className={`muted ${styles.feedback}`} role="status">{message}</p> : null}
  </section>;
}
