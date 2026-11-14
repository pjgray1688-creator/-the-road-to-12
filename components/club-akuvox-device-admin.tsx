"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./club-akuvox-device-admin.module.css";

type Location = { id: string; name: string; active: boolean; accessMode: string };
type Device = { id: string; name: string; status: "active" | "disabled"; locationId: string; createdAt: string; lastSeenAt: string | null };
type ProvisionResult = { deviceId: string; deviceSecret: string; status: "disabled" };
type DurationSetting = { requestedSeconds: number; saved: boolean; hardwareVerified: boolean; hardwareVerifiedAt: string | null; hardwareReadbackSeconds: number | null };

export function ClubAkuvoxDeviceAdmin({ organisationId, location, devices, durationSetting }: { organisationId: string; location: Location | null; devices: Device[]; durationSetting: DurationSetting | null }) {
  const router = useRouter();
  const [name, setName] = useState("Rotherham Akuvox A02S");
  const [requestId, setRequestId] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(durationSetting?.requestedSeconds ?? 5);

  async function request(action: "provision" | "status" | "doorDuration" | "confirmDoorDurationReadback", values: Record<string, unknown>) {
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

  async function saveDuration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      await request("doorDuration", { seconds: durationSeconds });
      setMessage("R12 request saved. This does not change the A02S relay; the hardware remains unverified until its Hold Delay is read back.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The requested duration could not be saved."); }
    finally { setBusy(false); }
  }

  async function confirmDurationReadback() {
    if (!durationSetting?.saved || !window.confirm(`Confirm you have configured and read back ${durationSetting.requestedSeconds} seconds in the Rotherham A02S relay settings? This records a manual check; R12 cannot query the relay.`)) return;
    setBusy(true); setMessage("");
    try {
      await request("confirmDoorDurationReadback", { seconds: durationSetting.requestedSeconds });
      setMessage("Manual A02S read-back recorded and audited. R12 does not monitor relay settings remotely.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The device read-back could not be recorded."); }
    finally { setBusy(false); }
  }

  const modeLabel = location?.accessMode === "DOOR_CONTROLLED" ? "Door controlled" : location?.accessMode === "CHECKIN_ONLY" ? "Check-in only" : location?.accessMode === "DISABLED" ? "Disabled" : "Unavailable";
  return <section className={styles.panel} aria-labelledby="akuvox-devices-title">
    <div className={styles.heading}><div><span className="eyebrow">MANAGEMENT · ROTHERHAM</span><h2 id="akuvox-devices-title">Akuvox gateway</h2></div><span className={styles.mode}>Venue mode: {modeLabel}</span></div>
    <p className={styles.intro}>Provision the existing R12 access-device record for the on-site gateway. New devices start disabled. PIN eligibility remains decided by R12. If the gateway cannot reach R12, the request is denied; offline authorization is not configured.</p>
    {!location ? <p className={styles.notice} role="status">The Madhouse Rotherham location is not available in this organisation.</p> : <>
      {location.accessMode === "DOOR_CONTROLLED" ? <p className={styles.notice} role="alert">Rotherham is currently marked Door controlled. Device activation is blocked unless the location is returned to Check-in only first.</p> : null}
      <form className={styles.form} onSubmit={provision}>
        <label>Device name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required /></label>
        <div className={styles.scope}><strong>Organisation and venue are fixed by the server</strong><span>{location.name} · {location.active ? "Active location" : "Inactive location"}</span></div>
        <button className="primary" type="submit" disabled={busy || !location.active}>{busy ? "Provisioning…" : "Register disabled gateway"}</button>
      </form>
      {result ? <div className={styles.secret} role="status"><strong>Copy this one-time gateway secret now</strong><label>R12 device ID<code>{result.deviceId}</code></label><label>R12 device secret<code>{result.deviceSecret}</code></label><p>Store it only in the gateway host’s protected environment. Do not enter it into Akuvox or share it in a ticket/message. This device is still disabled.</p><button type="button" className="secondary" onClick={() => { void navigator.clipboard?.writeText(result.deviceSecret).then(() => setMessage("Secret copied. Store it securely now.")); }}>Copy secret</button><button type="button" className="secondary" onClick={() => setResult(null)}>Hide secret</button></div> : null}
      <div className={styles.deviceList}><h3>Registered Rotherham devices</h3>{devices.length ? devices.map(device => <article className={styles.device} key={device.id}><div><strong>{device.name}</strong><span>{device.status === "active" ? `Active · venue mode: ${location.accessMode === "CHECKIN_ONLY" ? "check-in only" : location.accessMode === "DOOR_CONTROLLED" ? "door controlled" : "disabled"}` : "Disabled"} · Last authenticated gateway request to R12 {device.lastSeenAt ? `${device.lastSeenAt.replace("T", " ").slice(0, 16)} UTC` : "not reported"}</span><code>{device.id}</code></div><div className={styles.actions}>{device.status === "disabled" && location.accessMode === "CHECKIN_ONLY" ? <button type="button" className="secondary" disabled={busy} onClick={() => void setStatus(device, "active")}>Enable for check-in test</button> : null}{device.status === "active" ? <button type="button" className="danger" disabled={busy} onClick={() => void setStatus(device, "disabled")}>Revoke device</button> : null}</div></article>) : <p className={styles.empty}>No Rotherham Akuvox gateway is registered.</p>}</div>
      <section className={styles.duration} aria-labelledby="door-duration-title">
        <div className={styles.durationHeading}><h3 id="door-duration-title">Door Access · relay duration</h3><span className={styles.syncState}>{durationSetting?.hardwareVerified ? "Manually verified" : "Not synchronized"}</span></div>
        <p>Requested Rotherham relay Hold Delay. The default is 5 seconds; choose 3–10 seconds. Saving here stores the R12 request only and does not change the physical relay.</p>
        {durationSetting ? <>
          <div className={styles.durationSummary}><strong>Saved R12 request: {durationSetting.requestedSeconds} seconds</strong><span>{durationSetting.saved ? "Stored in R12" : "Default value; not saved yet"}</span></div>
          {durationSetting.hardwareVerified && durationSetting.hardwareVerifiedAt
            ? <p className={styles.verified} role="status">Manual A02S read-back: {durationSetting.hardwareReadbackSeconds} seconds · {new Date(durationSetting.hardwareVerifiedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}. This is not live device monitoring.</p>
            : <p className={styles.notice} role="status">Not verified on the A02S. Set the physical Hold Delay, then return and record the matching read-back.</p>}
          <form className={styles.durationForm} onSubmit={saveDuration}>
            <label htmlFor="door-duration-seconds">Requested duration</label>
            <select id="door-duration-seconds" value={durationSeconds} onChange={event => setDurationSeconds(Number(event.target.value))} disabled={busy}>
              {Array.from({ length: 8 }, (_, index) => index + 3).map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
            </select>
            <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Save R12 request"}</button>
          </form>
          <button type="button" className="secondary" disabled={busy || !durationSetting.saved || durationSeconds !== durationSetting.requestedSeconds} onClick={() => void confirmDurationReadback()}>
            Record matching A02S read-back
          </button>
        </> : <p className={styles.notice} role="status">Door-duration storage is unavailable. Apply the reviewed door-duration migration before using this control.</p>}
        <p className={styles.caution}>Hardware setup is performed in the Akuvox device interface under Access Control → Relay. Door-sensor configuration may relock as soon as the door physically closes, before the Hold Delay expires. Confirm the installer’s relay mode and door-sensor setup; this page never simulates or unlocks the door.</p>
      </section>
    </>}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
  </section>;
}
