"use client";
import { useState, useTransition } from "react";
import { completeGlowZoneCustomerDetailsAction } from "@/app/glow-zone/actions";
import type { GlowZoneCustomerDetails, GlowZoneCustomerField } from "@/lib/glow-zone-customer-details";

export function GlowZoneCustomerDetailsPanel({ details, missing, declaredUnder18 = false }: { details: GlowZoneCustomerDetails; missing: GlowZoneCustomerField[]; declaredUnder18?: boolean }) {
  const [values, setValues] = useState(details); const [message, setMessage] = useState(""); const [pending, startTransition] = useTransition();
  if (!missing.length) return declaredUnder18 ? <div className="surface-card glow-age-block" role="alert"><h2>Sunbed use is unavailable</h2><p>Your declared date of birth indicates that you are under 18. Staff cannot override this restriction during age verification.</p></div> : null;
  const field = (key: GlowZoneCustomerField, label: string, type = "text") => missing.includes(key) ? <label>{label}<input required type={type} autoComplete={key === "firstName" ? "given-name" : key === "lastName" ? "family-name" : "tel"} value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></label> : null;
  const save = () => startTransition(async () => {
    setMessage("");
    const result = await completeGlowZoneCustomerDetailsAction({ firstName: values.firstName, lastName: values.lastName, phone: values.phone });
    if (!result.ok) { setMessage(result.error); return; }
    window.location.reload();
  });
  return <div className="surface-card glow-customer-details"><h2>Complete your customer details</h2><p className="muted">Add only the missing details below. Your existing R12 and Glow Zone information will be preserved.</p>{field("firstName", "First name")}{field("lastName", "Last name")}{field("phone", "Mobile phone", "tel")}<p className="muted">Sunbed use requires an in-person 18+ check at reception. Glow Zone does not need to retain your date of birth or ID documents.</p><button className="primary" type="button" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save customer details"}</button>{message ? <p role="alert">{message}</p> : null}</div>;
}
