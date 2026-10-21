"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeInductionBookingAction, getCustomerInductionStagesAction, recordCustomerInductionCompletionAction, recordCustomerInductionStageAction, type InductionStagesSnapshot } from "@/app/club/induction/actions";

type Location = { id: string; name: string };

export function ClubMemberInductionCompletion({ organisationId, customerId, bookingId, startsAt, initialLocationId, locations, canPerform, required, inductionState }: {
  organisationId: string; customerId: string; bookingId?: string; startsAt?: string; initialLocationId?: string; locations: Location[]; canPerform: boolean; required: boolean; inductionState?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [locationId, setLocationId] = useState(initialLocationId ?? (locations.length === 1 ? locations[0].id : ""));
  const [snapshot, setSnapshot] = useState<InductionStagesSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!canPerform || !required || !customerId || !locationId) { setSnapshot(null); setLoading(false); return; }
      setLoading(true); setLoadError(""); setSnapshot(null);
      void getCustomerInductionStagesAction({ organisationId, customerId, locationId, bookingId }).then(result => {
        if (!active) return;
        if (result.ok) setSnapshot(result.data);
        else setLoadError(result.error);
      }).catch(() => {
        if (active) setLoadError("The current induction stages could not be loaded. Try again.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [organisationId, customerId, locationId, bookingId, canPerform, required, loadAttempt]);

  if (!bookingId && (!canPerform || !required || !locations.length)) return null;
  if (inductionState === "complete") return <p className="status-pill">Induction complete</p>;
  const requiredStages = snapshot?.sections.filter(section => section.required) ?? [];
  const allRequiredComplete = Boolean(snapshot) && requiredStages.every(section => section.complete);

  const completeInduction = () => startTransition(async () => {
    setMessage("");
    const result = bookingId
      ? await completeInductionBookingAction({ organisationId, bookingId })
      : await recordCustomerInductionCompletionAction({ organisationId, customerId, locationId });
    setMessage(result.ok ? "Induction completed and recorded." : result.error ?? "Induction could not be completed.");
    if (result.ok) router.refresh();
  });

  return <div className="club-induction-completion">
    {bookingId ? <p className="muted">Booked induction{startsAt ? ` · ${new Date(startsAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : ""}</p> : <p className="muted">Work through the published in-person induction stages with the member. Each required stage is saved against your staff account and venue.</p>}
    {canPerform && !bookingId ? <label>Induction location<select value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Choose location</option>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label> : null}
    {!canPerform ? <p className="muted">An authorised staff member must record the in-person induction.</p> : null}
    {canPerform && required && locationId ? <section aria-label="Induction stages" aria-busy={loading}>
      {loading ? <p role="status">Loading the published induction stages…</p> : null}
      {loadError ? <div role="alert" className="error-text"><p>{loadError}</p><button type="button" className="secondary" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading stages</button></div> : null}
      {snapshot ? <>
        <p className="muted">Induction version {snapshot.version} · {requiredStages.filter(section => section.complete).length} of {requiredStages.length} required stages complete.</p>
        <ol className="club-induction-stages">{snapshot.sections.map(section => <li key={section.id}>
          <h3>{section.title}</h3><p>{section.content}</p>
          {section.required ? <label><input type="checkbox" checked={section.complete} disabled={section.complete || pending} onChange={() => startTransition(async () => {
            setMessage("");
            const result = await recordCustomerInductionStageAction({ organisationId, customerId, locationId, sectionId: section.id, bookingId });
            if (!result.ok) { setMessage(result.error ?? "This induction stage could not be saved."); return; }
            setSnapshot(current => current ? { ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, complete: true, checked_at: new Date().toISOString() } : item) } : current);
            router.refresh();
          })} /> {section.complete ? `Complete${section.checked_by_name ? ` · ${section.checked_by_name}` : ""}` : "Mark stage complete"}</label> : <small className="muted">Information</small>}
        </li>)}</ol>
        {allRequiredComplete ? <p className="muted">All required stages are saved. You can now record final completion.</p> : <p className="muted">Final completion stays unavailable until every required stage is saved.</p>}
        <button type="button" className="primary" disabled={pending || !allRequiredComplete} onClick={completeInduction}>{pending ? "Saving…" : "Record induction complete"}</button>
      </> : null}
    </section> : null}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </div>;
}
