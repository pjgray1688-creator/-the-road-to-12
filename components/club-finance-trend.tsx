"use client";
import { useState } from "react";

type Point = { date: string; label: string; netMinor: number; paymentsMinor: number };
const money = (amount: number) => `£${(amount / 100).toFixed(2)}`;

export function ClubFinanceTrend({ points }: { points: Point[] }) {
  const [series, setSeries] = useState<"net" | "payments">("net");
  const values = points.map(point => series === "net" ? point.netMinor : point.paymentsMinor);
  const max = Math.max(1, ...values);
  const width = 720;
  const height = 190;
  const coords = values.map((value, index) => ({ x: points.length < 2 ? width / 2 : 12 + index * (width - 24) / (points.length - 1), y: height - 16 - value / max * (height - 30), value }));
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  return <section aria-label="Financial trend" className="club-finance-trend">
    <div className="club-finance-trend-head"><div><span className="eyebrow">TREND</span><h2>{series === "net" ? "Net sales" : "Payments received"}</h2></div><div role="group" aria-label="Trend metric"><button type="button" aria-pressed={series === "net"} onClick={() => setSeries("net")}>Net sales</button><button type="button" aria-pressed={series === "payments"} onClick={() => setSeries("payments")}>Payments</button></div></div>
    {points.length ? <><svg role="img" aria-label={`${series === "net" ? "Net sales" : "Payments received"} trend by day`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><path d={`M12 ${height - 16} H${width - 12}`} className="club-finance-axis"/><path d={path} className="club-finance-line"/>{coords.map((point, index) => <circle key={points[index].date} cx={point.x} cy={point.y} r="4"><title>{points[index].label}: {money(point.value)}</title></circle>)}</svg><div className="club-finance-trend-labels"><span>{points[0].label}</span><span>{points.at(-1)?.label}</span></div><div className="sr-only">{points.map(point => `${point.label}: ${money(series === "net" ? point.netMinor : point.paymentsMinor)}`).join(". ")}</div></> : <p className="muted">No recorded financial activity in this period.</p>}
  </section>;
}
