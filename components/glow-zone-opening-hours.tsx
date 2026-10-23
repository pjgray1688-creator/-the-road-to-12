import { Surface } from "@/components/ui";

export type GlowZoneHourRow = { weekday: number; opens_local: string | null; closes_local: string | null; confirmation_state: "confirmed" | "confirmed_closed" | "unconfirmed"; time_zone: string };
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const time = (value: string) => value.slice(0, 5);
export function GlowZoneOpeningHours({ hours }: { hours: GlowZoneHourRow[] }) {
  const rows = [...hours].sort((a,b)=>a.weekday-b.weekday);
  return <Surface><details className="glow-hours"><summary><span><strong>Glow Zone opening hours</strong><small>Sunbed service · {rows[0]?.time_zone ?? "Europe/London"}</small></span><span aria-hidden="true">＋</span></summary><div>{rows.length ? rows.map(row => <p className="muted" key={row.weekday}><strong>{days[row.weekday-1] ?? `Day ${row.weekday}`}</strong><span>{row.confirmation_state === "confirmed_closed" ? "Closed" : row.confirmation_state === "confirmed" && row.opens_local && row.closes_local ? `${time(row.opens_local)}–${time(row.closes_local)}` : "Hours not confirmed"}</span></p>) : <p className="muted">Opening hours are temporarily unavailable. Please ask reception.</p>}<p className="muted">These hours apply to sunbed services only. Madhouse gym access remains open 24 hours.</p></div></details></Surface>;
}
