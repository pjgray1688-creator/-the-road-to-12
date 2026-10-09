"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeInductionBookingAction, recordCustomerInductionCompletionAction } from "@/app/club/induction/actions";

export function ClubMemberInductionCompletion({ organisationId, customerId, bookingId, startsAt, locations, canPerform, required }: {
  organisationId: string; customerId: string; bookingId?: string; startsAt?: string; locations: Array<{ id: string; name: string }>; canPerform: boolean; required: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [locationId, setLocationId] = useState("");
  const [pending, startTransition] = useTransition();
  if (!bookingId && (!canPerform || !required || !locations.length)) return null;
  return <div className="club-induction-completion">
    {bookingId ? <p className="muted">Booked induction{startsAt ? ` · ${new Date(startsAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : ""}</p> : <p className="muted">Record an in-person induction completed at reception.</p>}
    {canPerform && !bookingId ? <label>Induction location<select value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Choose location</option>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label> : null}
    {canPerform ? <button type="button" className="secondary" disabled={pending || (!bookingId && !locationId)} onClick={() => startTransition(async () => {
      const result = bookingId
        ? await completeInductionBookingAction({ organisationId, bookingId })
        : await recordCustomerInductionCompletionAction({ organisationId, customerId, locationId });
      setMessage(result.ok ? "Induction completed and recorded." : result.error ?? "Induction could not be completed.");
      if (result.ok) router.refresh();
    })}>{pending ? "Saving…" : bookingId ? "Record induction complete" : "Record completion"}</button> : null}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </div>;
}
