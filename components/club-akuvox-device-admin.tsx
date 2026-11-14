"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./club-akuvox-device-admin.module.css";

type Location = { id: string; name: string; active: boolean; accessMode: string };
type Device = { id: string; name: string; status: "active" | "disabled"; locationId: string; createdAt: string; lastSeenAt: string | null };
type ProvisionResult = { deviceId: string; deviceSecret: string; status: "disabled" };

export function ClubAkuvoxDeviceAdmin({ organisationId, location, devices }: { organisationId: string; location: Location | null; devices: Device[] }) {
  const router = useRouter();
  const [name, setName] = useState("Rotherham Akuvox A02S");
  const [requestId, setRequestId] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(action: "provision" | "status", values: Record<string, unknown>) {
    const response = await fetch("/api/club/access-devices", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ organisationId, action, ...values }),
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The device request failed.");
    return body;
  }

  async function provision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!location?.active || location.name.trim().toLocaleLowerCase() !== "rotherham") return;
    setBusy(true); setMessage(""); setResult(null);
    const stableRequestId = requestId || crypto.randomUUID();
    setRequestId(stableRequestId);
    try {
      const body = await request("provision", { locationId: location.id, deviceId: stableRequestId, name });
      if (typeof body.deviceId !== "string" || typeof body.deviceSecret !== "string") throw new Error("The one-time gateway credential was not returned. Retry with this form open.");
      setResult({ deviceId: body.deviceId, deviceSecret: body.deviceSecret, status: "disabled" });
      setRequestId("");
      setMessage("Device registered disabled. Copy the secret now; it cannot be retrieved later.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The device could not be provisioned.");
    } finally { setBusy(false); }
  }

  async function setStatus(device: Device, status: "active" | "disabled") {
    const reason = status === "disabled" ? window.prompt("Reason for revoking this device") : null;
    if (status === "disabled" && !reason?.trim()) return;
    if (status === "active" && !window.confirm("Enable this device for decision testing? Rotherham must remain Check-in only; no door unlock will be permitted.")) return;
    setBusy(true); setMessage("");
    try {
      await request("status", { deviceId: device.id, status, reason: reason ?? "" });
      setMessage(status === "disabled" ? "Device revoked. Its stored secret will no longer authenticate." : "Device enabled for Check-in only testing; door unlock remains denied.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The device status could not be changed."); }
    finally { setBusy(false); }
  }

  const modeLabel = location?.accessMode === "DOOR_CONTROLLED" ? "Door controlled" : location?.accessMode === "CHECKIN_ONLY" ? "Check-in only" : location?.accessMode === "DISABLED" ? "Disabled" : "Unavailable";
  return <section className={styles.panel} aria-labelledby="akuvox-devices-title">
    <div className={styles.heading}><div><span className="eyebrow">MANAGEMENT · ROTHERHAM</span><h2 id="akuvox-devices-title">Akuvox gateway</h2></div><span className={styles.mode}>Venue mode: {modeLabel}</span></div>
    <p className={styles.intro}>Provision the existing R12 access-device record for the on-site gateway. New devices start disabled. PIN eligibility remains decided by R12.</p>
    {!location ? <p className={styles.notice} role="status">The Madhouse Rotherham location is not available in this organisation.</p> : <>
      {location.accessMode === "DOOR_CONTROLLED" ? <p className={styles.notice} role="alert">Rotherham is currently marked Door controlled. Device activation is blocked unless the location is returned to Check-in only first.</p> : null}
      <form className={styles.form} onSubmit={provision}>
        <label>Device name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required /></label>
        <div className={styles.scope}><strong>Organisation and venue are fixed by the server</strong><span>{location.name} · {location.active ? "Active location" : "Inactive location"}</span></div>
        <button className="primary" type="submit" disabled={busy || !location.active}>{busy ? "Provisioning…" : "Register disabled gateway"}</button>
      </form>
      {result ? <div className={styles.secret} role="status"><strong>Copy this one-time gateway secret now</strong><label>R12 device ID<code>{result.deviceId}</code></label><label>R12 device secret<code>{result.deviceSecret}</code></label><p>Store it only in the gateway host’s protected environment. Do not enter it into Akuvox or share it in a ticket/message. This device is still disabled.</p><button type="button" className="secondary" onClick={() => { void navigator.clipboard?.writeText(result.deviceSecret).then(() => setMessage("Secret copied. Store it securely now.")); }}>Copy secret</button><button type="button" className="secondary" onClick={() => setResult(null)}>Hide secret</button></div> : null}
      <div className={styles.deviceList}><h3>Registered Rotherham devices</h3>{devices.length ? devices.map(device => <article className={styles.device} key={device.id}><div><strong>{device.name}</strong><span>{device.status === "active" ? "Active · check-in only" : "Disabled"} · Last seen {device.lastSeenAt ? `${device.lastSeenAt.replace("T", " ").slice(0, 16)} UTC` : "never"}</span><code>{device.id}</code></div><div className={styles.actions}>{device.status === "disabled" && location.accessMode === "CHECKIN_ONLY" ? <button type="button" className="secondary" disabled={busy} onClick={() => void setStatus(device, "active")}>Enable for check-in test</button> : null}{device.status === "active" ? <button type="button" className="danger" disabled={busy} onClick={() => void setStatus(device, "disabled")}>Revoke device</button> : null}</div></article>) : <p className={styles.empty}>No Rotherham Akuvox gateway is registered.</p>}</div>
    </>}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
  </section>;
}
