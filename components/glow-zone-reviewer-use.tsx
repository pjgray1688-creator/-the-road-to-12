"use client";

import { useState } from "react";
import { AppShell, Surface } from "@/components/ui";
import { GlowZoneHeader } from "@/components/glow-zone-header";
import { GlowZoneNav } from "@/components/glow-zone-nav";

export function GlowZoneReviewerUse() {
  const [bed, setBed] = useState<"stand" | "lie">("stand");
  const [minutes, setMinutes] = useState(8);
  const [preview, setPreview] = useState(false);

  return (
    <AppShell className="module-page glow-zone-page">
      <GlowZoneHeader title="Use a sunbed" description="Choose your session, then let reception approve it." demo />
      <Surface>
        <span className="eyebrow glow-green">45 EXAMPLE MINUTES</span>
        <h2>Choose your session</h2>
        <fieldset className="glow-bed-picker">
          <legend>Sunbed type</legend>
          <button type="button" className={bed === "stand" ? "selected" : ""}
            onClick={() => { setBed("stand"); setPreview(false); }}>
            <strong>Stand-up</strong>
          </button>
          <button type="button" className={bed === "lie" ? "selected" : ""}
            onClick={() => { setBed("lie"); setPreview(false); }}>
            <strong>Lying-down</strong>
          </button>
        </fieldset>
        <div className="glow-duration">
          <span>Session duration</span>
          <div>
            <button type="button" onClick={() => setMinutes(Math.max(1, minutes - 1))}>−</button>
            <strong>{minutes} <small>minutes</small></strong>
            <button type="button" onClick={() => setMinutes(Math.min(15, minutes + 1))}>+</button>
          </div>
          <input aria-label="Session duration" type="range" min="1" max="15"
            value={minutes} onChange={e => setMinutes(Number(e.target.value))} />
        </div>
        <div className="glow-selection">
          <span>Your selection</span>
          <strong>{bed === "stand" ? "Stand-up" : "Lying-down"} · {minutes} minutes</strong>
        </div>
        <button className="primary full" onClick={() => setPreview(true)}>
          Continue
        </button>
      </Surface>
      {preview && (
        <Surface>
          <span className="eyebrow">SESSION PREVIEW</span>
          <h2>Ready to scan</h2>
          <p>Show your session QR code to reception.</p>
          <div className="glow-reviewer-qr-placeholder" role="img"
            aria-label="Demo session; no scannable redemption code">
            <strong>DEMO</strong>
            <span>No live QR generated</span>
          </div>
          <p className="muted">
            {bed === "stand" ? "Stand-up" : "Lying-down"} · {minutes} minutes.
            No real minutes will be deducted.
          </p>
        </Surface>
      )}
      <GlowZoneNav current="use" />
    </AppShell>
  );
}
