"use client";

import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export function ClubPinSettings({ organisationId }: { organisationId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const client = browserSupabase();
    if (!client) return;
    void client.rpc("club_station_my_pin_status", { p_organisation_id: organisationId }).then(({ data }) => {
      setEnabled(data === true);
      setEditing(data !== true);
    });
  }, [organisationId]);

  const save = async (disable = false) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/club/station/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ organisationId, password, action: disable ? "disable" : "set", ...(disable ? {} : { pin }) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Your Club PIN could not be updated.");
      setEnabled(!disable);
      setPin("");
      setPassword("");
      setMessage(disable ? "Quick Club PIN disabled." : "Quick Club PIN saved. Refresh the station staff list to use it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your Club PIN could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="club-pin-settings">
    <span className="eyebrow">SHARED STATION ACCESS</span>
    <h2>{enabled ? "Club PIN is set" : "Set a quick Club PIN"}</h2>
    <p className="muted">Your PIN is securely hashed and unlocks only your staff identity. It does not replace your R12 password.</p>
    {enabled && !editing ? <div className="club-pin-actions">
      <button className="secondary" type="button" onClick={() => { setEditing(true); setMessage(""); }}>Change PIN</button>
      <label>Confirm your R12 password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="secondary" type="button" disabled={busy || !password} onClick={() => void save(true)}>Disable PIN</button>
    </div> : <>
      <label>Confirm your R12 password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>New PIN (4–6 digits)<input inputMode="numeric" autoComplete="new-password" type="password" pattern="[0-9]{4,6}" maxLength={6} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
      <div className="club-pin-actions">
        <button className="primary" type="button" disabled={busy || !password || pin.length < 4} onClick={() => void save(false)}>{busy ? "Confirming…" : enabled ? "Save new PIN" : "Save PIN"}</button>
        {enabled ? <button className="secondary" type="button" onClick={() => { setEditing(false); setPassword(""); setPin(""); }}>Cancel</button> : null}
      </div>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
