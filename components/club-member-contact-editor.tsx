"use client";

import { useState, useTransition } from "react";
import { updateMemberContactAction } from "@/app/club/members/[userId]/actions";
import styles from "./club-member-contact-editor.module.css";

type Contact = { phone?: string | null; address_line_1?: string | null; address_line_2?: string | null; town_city?: string | null; postcode?: string | null };

export function ClubMemberContactEditor({ organisationId, userId, contact }: { organisationId: string; userId: string; contact: Contact }) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return <div className={styles.editor}>
    {!editing ? <button className={styles.edit} type="button" onClick={() => { setMessage(""); setEditing(true); }}>Edit contact details</button> : <form action={formData => startTransition(async () => {
      const result = await updateMemberContactAction({ organisationId, userId, phone: String(formData.get("phone") ?? ""), addressLine1: String(formData.get("addressLine1") ?? ""), addressLine2: String(formData.get("addressLine2") ?? ""), townCity: String(formData.get("townCity") ?? ""), postcode: String(formData.get("postcode") ?? "") });
      setMessage(result.ok ? "Contact details saved." : result.error);
      if (result.ok) setEditing(false);
    })}>
      <div className={styles.fields}>
        <label>Telephone<input name="phone" type="tel" maxLength={40} defaultValue={contact.phone ?? ""} autoComplete="tel" /></label>
        <label>Address line 1<input name="addressLine1" maxLength={160} defaultValue={contact.address_line_1 ?? ""} autoComplete="address-line1" /></label>
        <label>Address line 2<input name="addressLine2" maxLength={160} defaultValue={contact.address_line_2 ?? ""} autoComplete="address-line2" /></label>
        <label>Town or city<input name="townCity" maxLength={100} defaultValue={contact.town_city ?? ""} autoComplete="address-level2" /></label>
        <label>Postcode<input name="postcode" maxLength={20} defaultValue={contact.postcode ?? ""} autoComplete="postal-code" /></label>
      </div>
      <div className={styles.actions}><button className={styles.save} type="submit" disabled={pending}>{pending ? "Saving…" : "Save contact details"}</button><button className={styles.cancel} type="button" disabled={pending} onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button></div>
    </form>}
    {message ? <p role="status" className={styles.message}>{message}</p> : null}
  </div>;
}
