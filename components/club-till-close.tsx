"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeTillCloseAction, previewTillCloseAction } from "@/app/club/shop/actions";
import { calculateTillVarianceMinor } from "@/lib/club-till";

type Location = { id: string; name: string };
type TillClose = { id: string; location_id: string; business_date: string; register_name: string; expected_cash_minor: number; counted_cash_minor: number; variance_minor: number; notes: string | null; closed_at: string; closed_by: string };
const money = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const todayLondon = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function ClubTillClose({ organisationId, locations, initialLocationId, history }: { organisationId: string; locations: Location[]; initialLocationId?: string; history: TillClose[] }) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(initialLocationId ?? locations[0]?.id ?? "");
  const [businessDate, setBusinessDate] = useState(todayLondon);
  const registerName = "Main till";
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [previewState, setPreviewState] = useState<{ key: string; value?: { expectedMinor: number; alreadyClosed: boolean; closedAt?: string }; error?: string }>();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const locationName = locations.find(location => location.id === locationId)?.name ?? "Selected location";
  const countedMinor = /^\d+(\.\d{1,2})?$/.test(counted) ? Math.round(Number(counted) * 100) : undefined;
  const previewKey = `${locationId}|${businessDate}|${registerName}`;
  const preview = previewState?.key === previewKey ? previewState.value : undefined;
  const previewError = previewState?.key === previewKey ? previewState.error : undefined;
  const variance = preview && countedMinor !== undefined ? calculateTillVarianceMinor(countedMinor, preview.expectedMinor) : undefined;

  useEffect(() => {
    let active = true;
    if (!locationId || !businessDate || !registerName.trim()) return () => { active = false; };
    void previewTillCloseAction({ organisationId, locationId, businessDate, registerName }).then(result => {
      if (!active) return;
      if (!result.ok) { setPreviewState({ key: previewKey, error: result.error }); return; }
      setPreviewState({ key: previewKey, value: { expectedMinor: result.expectedMinor, alreadyClosed: result.alreadyClosed, closedAt: result.closedAt } });
    });
    return () => { active = false; };
  }, [organisationId, locationId, businessDate, registerName, previewKey]);

  const submit = () => {
    if (countedMinor === undefined || countedMinor < 0 || !preview || preview.alreadyClosed) return;
    setError("");
    const idempotencyKey = crypto.randomUUID();
    startTransition(async () => {
      const result = await completeTillCloseAction({ organisationId, locationId, businessDate, registerName, countedAmount: (countedMinor / 100).toFixed(2), notes, idempotencyKey });
      if (!result.ok) { setError(result.error); return; }
      setCounted(""); setNotes("");
      setError(result.varianceMinor === 0 ? "Till closed. Count matches expected cash." : `Till closed with a ${result.varianceMinor > 0 ? "surplus" : "shortfall"} of ${money(Math.abs(result.varianceMinor))}.`);
      router.refresh();
    });
  };

  return <section aria-label="Counted till close" className="club-till-close">
    <div className="section-header"><div><span className="eyebrow">CASH CONTROL</span><h2>Close a till</h2><p className="muted">Expected cash is calculated from settled cash sales, cash refunds and confirmed cash declarations for the selected location and UK business date.</p></div></div>
    <div className="club-profile-grid">
      <label>Location<select value={locationId} onChange={event => setLocationId(event.target.value)}>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
      <label>Business date<input type="date" value={businessDate} onChange={event => setBusinessDate(event.target.value)} /></label>
      <label>Register<input value={registerName} readOnly aria-label="Register" /></label>
    </div>
    {preview ? <div className="club-detail-row" style={{ marginTop: 12 }}><span><strong>Expected in {locationName}</strong><small>{businessDate} · {registerName}</small></span><strong>{money(preview.expectedMinor)}</strong></div> : null}
    {preview?.alreadyClosed ? <p role="status" className="muted">This register has already been closed for that date. Completed closes are retained as read-only history{preview.closedAt ? ` · closed ${new Date(preview.closedAt).toLocaleString("en-GB")}` : ""}.</p> : null}
    {preview && !preview.alreadyClosed ? <>
      <div className="club-profile-grid" style={{ marginTop: 12 }}>
        <label>Counted cash (£)<input aria-label="Counted cash" inputMode="decimal" type="number" min="0" step="0.01" value={counted} onChange={event => setCounted(event.target.value)} /></label>
        <label>Notes (optional)<input aria-label="Till close notes" maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      </div>
      {variance !== undefined ? <p role="status" className="muted">Variance preview: <strong>{variance === 0 ? "Matches expected cash" : `${variance > 0 ? "Surplus" : "Shortfall"} ${money(Math.abs(variance))}`}</strong></p> : null}
      <button type="button" className="primary" onClick={submit} disabled={pending || countedMinor === undefined || !registerName.trim()}>{pending ? "Closing…" : "Complete till close"}</button>
    </> : null}
    {previewError ? <p role="status" className="muted">{previewError}</p> : null}
    {error ? <p role="status" className="muted">{error}</p> : null}
    <div style={{ marginTop: 24 }}><span className="eyebrow">RECENT CLOSES</span>{history.filter(close => close.location_id === locationId).length ? history.filter(close => close.location_id === locationId).map(close => <div className="club-detail-row" key={close.id}><span><strong>{locations.find(location => location.id === close.location_id)?.name ?? "Location"} · {close.register_name}</strong><small>{close.business_date} · closed {new Date(close.closed_at).toLocaleString("en-GB")}{close.notes ? ` · ${close.notes}` : ""}</small></span><span>Expected {money(close.expected_cash_minor)} · Counted {money(close.counted_cash_minor)}<br/><strong>{close.variance_minor === 0 ? "Balanced" : `${close.variance_minor > 0 ? "Surplus" : "Shortfall"} ${money(Math.abs(close.variance_minor))}`}</strong></span></div>) : <p className="muted">No completed till closes yet.</p>}</div>
  </section>;
}
