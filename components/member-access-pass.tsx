import { accessQrMatrix } from "@/lib/qr-code";

export type MemberAccessPassData = {
  pin: string;
  qrToken: string;
  accessAllowed: boolean;
  accessState: string;
  reason: string;
  validFrom?: string;
  validUntil?: string;
  graceState?: string;
  lastRecalculated?: string;
};

const accessStateLabel: Record<string, string> = {
  active: "Active",
  grace: "Grace period",
  action_required: "Action required",
  not_started: "Not started",
  expired: "Expired",
  cancelled: "Cancelled",
  inactive: "Inactive",
  no_access: "No access",
};

export function MemberAccessPass({ pass }: { pass: MemberAccessPassData }) {
  const matrix = accessQrMatrix(pass.qrToken);
  const quietZone = 4;
  const size = matrix.length + quietZone * 2;
  const modules = matrix.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + quietZone} ${y + quietZone}h1v1h-1z` : "")).join("");
  return <div className="member-access-pass">
    <div className="section-heading-row">
      <div><span className="eyebrow">ACCESS PASS</span><h2>{accessStateLabel[pass.accessState] ?? "No access"}</h2></div>
      <strong>{pass.accessAllowed ? "READY" : "NOT ACTIVE"}</strong>
    </div>
    <div style={{ display: "grid", placeItems: "center", padding: "16px 0" }}>
      <svg aria-label="Your Madhouse QR access pass" role="img" viewBox={`0 0 ${size} ${size}`} width={320} height={320} shapeRendering="crispEdges" style={{ background: "white", borderRadius: 12, width: "min(78vw, 320px)", height: "auto" }}>
        <rect width={size} height={size} fill="white"/>
        <path d={modules} fill="black"/>
      </svg>
    </div>
    <p className="muted">Show this QR at check-in. Access is always confirmed live.</p>
    <div className="club-detail-row"><span>Personal access PIN</span><strong style={{ fontSize: "1.7rem", letterSpacing: "0.18em" }}>{pass.pin}</strong></div>
    {pass.accessState === "grace" ? <p className="muted">Access remains active during the current payment grace or retry period.</p> : null}
    {pass.validUntil ? <p className="muted">Current access valid until {new Date(pass.validUntil).toLocaleString("en-GB")}.</p> : null}
    <p className="muted">Your PIN and QR stay the same when your membership or preferred gym changes. They work at any enabled Madhouse venue while you have valid access.</p>
  </div>;
}
