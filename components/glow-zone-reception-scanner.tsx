"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  confirmGlowSessionRequestAction,
  scanGlowSessionRequestAction,
  verifyGlowAgeAction,
} from "@/app/club/sunbeds/actions";
import { glowBedLabel, type GlowReceptionRequest } from "@/lib/glow-zone";
import styles from "@/components/club-glow-zone-workspace.module.css";

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect(video: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
};

export function GlowZoneReceptionScanner({
  organisationId,
  locationId,
  canVerifyAge,
}: {
  organisationId: string;
  locationId?: string;
  canVerifyAge: boolean;
}) {
  const [token, setToken] = useState("");
  const [request, setRequest] = useState<GlowReceptionRequest | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [bedConfirmed, setBedConfirmed] = useState(false);
  const [durationConfirmed, setDurationConfirmed] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pending, startTransition] = useTransition();
  const verificationInFlight = useRef(false);
  const redemptionInFlight = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stop = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => stop, []);

  const lookup = (value = token) => {
    stop();
    setMessage("");
    setError(false);
    setRequest(null);
    setBedConfirmed(false);
    setDurationConfirmed(false);
    setAdultConfirmed(false);
    if (!locationId) {
      setError(true);
      setMessage("The Carlton Glow Zone location is unavailable.");
      return;
    }
    startTransition(async () => {
      const result = await scanGlowSessionRequestAction({ organisationId, locationId, token: value });
      if (result.ok) {
        setToken(result.token);
        setRequest(result.request);
      } else {
        setError(true);
        setMessage(result.error);
      }
    });
  };

  const startCamera = async () => {
    const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError(true);
      setMessage("Camera QR scanning is not available. Enter the customer’s code instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
      const detector = new Detector({ formats: ["qr_code"] });
      const read = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          const value = found[0]?.rawValue;
          if (value) {
            setToken(value);
            lookup(value);
          } else requestAnimationFrame(() => void read());
        } catch {
          stop();
          setError(true);
          setMessage("QR scanning stopped unexpectedly. Enter the customer’s code instead.");
        }
      };
      requestAnimationFrame(() => void read());
    } catch {
      stop();
      setError(true);
      setMessage("Camera access was unavailable. Enter the customer’s code instead.");
    }
  };

  const verify = () => {
    if (!request || !locationId || !adultConfirmed || verificationInFlight.current || pending) return;
    verificationInFlight.current = true;
    setMessage("");
    setError(false);
    startTransition(async () => {
      try {
        const result = await verifyGlowAgeAction({
          organisationId,
          userId: request.user_id,
          locationId,
          isAdult: true,
        });
        if (!result.ok) {
          setError(true);
          setMessage(result.error ?? "Age verification could not be recorded.");
          return;
        }
        setAdultConfirmed(false);
        const refreshed = await scanGlowSessionRequestAction({ organisationId, locationId, token });
        if (refreshed.ok) {
          setRequest(refreshed.request);
          setMessage(
            refreshed.request.age_status === "verified"
              ? "18+ check recorded. No date of birth or ID details were stored."
              : "Customer remains ineligible for Glow Zone.",
          );
        } else {
          setError(true);
          setMessage(refreshed.error);
        }
      } finally {
        verificationInFlight.current = false;
      }
    });
  };

  const confirm = () => {
    if (!request || !locationId || !ready || redemptionInFlight.current || pending) return;
    redemptionInFlight.current = true;
    setMessage("");
    setError(false);
    startTransition(async () => {
      try {
        const result = await confirmGlowSessionRequestAction({
          organisationId,
          locationId,
          token,
          bedType: request.bed_type,
          durationMinutes: request.duration_minutes,
        });
        if (!result.ok) {
          setError(true);
          setMessage(result.error);
          return;
        }
        setRequest({ ...request, status: "redeemed", redeemed_at: new Date().toISOString() });
        setMessage(
          result.result.already_used
            ? "This request was already approved. No second deduction was made."
            : "Session approved and minutes deducted once. Start the sunbed manually.",
        );
      } finally {
        redemptionInFlight.current = false;
      }
    });
  };

  const ready = Boolean(
    request &&
      request.status === "pending" &&
      request.age_status === "verified" &&
      request.balance_minutes >= request.duration_minutes &&
      bedConfirmed &&
      durationConfirmed &&
      locationId,
  );

  return (
    <section className={`${styles.panel} ${styles.scanPanel}`} aria-labelledby="glow-scan-title">
      <div className={styles.panelHeader}>
        <span className={styles.eyebrow}>Carlton reception</span>
        <h2 id="glow-scan-title">Scan customer QR</h2>
        <p>Ask the customer to select their minutes and show their session QR code.</p>
      </div>

      <form className={styles.scanControls} onSubmit={event => { event.preventDefault(); if (token.trim()) lookup(); }}>
        <label>
          Session code
          <input
            autoComplete="off"
            value={token}
            onChange={event => setToken(event.target.value)}
            aria-label="Glow Zone session code"
            placeholder="Scan or enter code"
          />
        </label>
        <button className={styles.button} type="submit" disabled={pending || !token.trim()}>
          {pending ? "Checking…" : "Find session"}
        </button>
        <button className={styles.secondary} type="button" disabled={pending} onClick={() => (scanning ? stop() : void startCamera())}>
          {scanning ? "Stop camera" : "Scan QR with camera"}
        </button>
      </form>
      {scanning ? <video className={styles.video} ref={videoRef} muted playsInline aria-label="QR scanner preview" /> : null}

      {request ? (
        <div className={styles.request} aria-live="polite">
          <div className={styles.requestHeading}>
            <div>
              <span className={styles.eyebrow}>Customer</span>
              <h3>{request.customer_name}</h3>
              {request.customer_email ? <p>{request.customer_email}</p> : null}
              {request.customer_phone ? <p>{request.customer_phone}</p> : null}
            </div>
            <span className={styles.state}>{request.status.replaceAll("_", " ")}</span>
          </div>
          <div className={styles.facts}>
            <div className={styles.fact}><small>Bed selected</small><strong>{glowBedLabel(request.bed_type)}</strong></div>
            <div className={styles.fact}><small>Requested time</small><strong>{request.duration_minutes} minutes</strong></div>
            <div className={styles.fact}><small>Available balance</small><strong>{request.balance_minutes} minutes</strong></div>
            <div className={styles.fact}><small>Age check</small><strong>{request.age_status === "verified" ? "Verified 18+" : request.age_status === "under_18" ? "Under 18" : "Required"}</strong></div>
          </div>

          {request.age_status === "required" && canVerifyAge && request.status === "pending" ? (
            <div className={styles.confirmGroup}>
              <label className={styles.check}>
                <input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} />
                I checked acceptable ID and confirm this customer is 18 or over.
              </label>
              <button className={styles.button} type="button" disabled={pending || !adultConfirmed} onClick={verify}>
                {pending ? "Saving check…" : "Confirm age verification"}
              </button>
              <small>Nothing is recorded until you select this confirmation action.</small>
            </div>
          ) : null}
          {request.age_status === "required" && !canVerifyAge ? <p className={styles.cameraNote}>An authorised Carlton staff member must check acceptable ID.</p> : null}
          {request.age_status === "under_18" ? <p className={styles.error}>Staff verification cannot override the under-18 restriction.</p> : null}

          {request.status === "pending" ? (
            <div className={styles.confirmGroup}>
              <label className={styles.check}><input type="checkbox" checked={bedConfirmed} onChange={event => setBedConfirmed(event.target.checked)} />I confirm the customer selected the {glowBedLabel(request.bed_type)} bed.</label>
              <label className={styles.check}><input type="checkbox" checked={durationConfirmed} onChange={event => setDurationConfirmed(event.target.checked)} />I confirm the requested duration is {request.duration_minutes} minutes.</label>
              <button className={styles.button} type="button" disabled={pending || !ready} onClick={confirm}>{pending ? "Approving…" : "Confirm session & deduct minutes"}</button>
              <small>Minutes are deducted only after this confirmation succeeds. Start the sunbed manually.</small>
            </div>
          ) : <p className={styles.error}>This request cannot be approved because it is {request.status}.</p>}
        </div>
      ) : null}
      {message ? <p role="status" className={styles.feedback} data-error={error}>{message}</p> : null}
    </section>
  );
}
