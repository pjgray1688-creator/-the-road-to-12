"use client";
import { useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, MetricCard, NavigationRow, PageHeader, Surface } from "@/components/ui";
import { loadData, saveData } from "@/lib/storage";
import { appendBodyMetric, latestMeasurement, measurementDelta, measurementEntries, measurementGuidance, measurementLabels, progressPhotoAvailability, removeBodyMetric, weightSummary } from "@/lib/progress";
import { personalBests } from "@/lib/training-history";
import type { BodyMeasurementType } from "@/lib/domain";

const measurementTypes = Object.keys(measurementLabels) as BodyMeasurementType[];
const today = () => new Date().toISOString().slice(0, 10);

export default function ProgressPage() {
  const [data, setData] = useState(() => loadData());
  const [weight, setWeight] = useState("");
  const [weightDate, setWeightDate] = useState(today());
  const [type, setType] = useState<BodyMeasurementType>("waist_navel");
  const [value, setValue] = useState("");
  const weights = useMemo(() => weightSummary(data.bodyMetrics), [data.bodyMetrics]);
  const entries = useMemo(() => measurementEntries(data.bodyMetrics), [data.bodyMetrics]);
  const bests = useMemo(() => personalBests(data.workouts).slice(0, 3), [data.workouts]);
  const commit = (next: typeof data) => { setData(next); saveData(next); };
  const addWeight = () => { const parsed = Number(weight); if (!Number.isFinite(parsed) || parsed <= 0) return; commit(appendBodyMetric(data, { id: crypto.randomUUID(), date: weightDate || today(), origin: "real", source: "manual", bodyweight: parsed, unit: "kg" })); setWeight(""); };
  const addMeasurement = () => { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0) return; commit(appendBodyMetric(data, { id: crypto.randomUUID(), date: today(), origin: "real", source: "manual", measurementType: type, value: parsed, unit: "cm" })); setValue(""); };
  return <AppShell className="module-page progress-page">
    <PageHeader eyebrow="PROGRESS" title="Progress" description="A clear view of the changes your training is creating." />
    <Surface><div className="section-header"><div><span className="eyebrow">BODY WEIGHT</span><h2>{weights.latest !== undefined ? `${weights.latest} kg` : "No weigh-ins yet"}</h2></div>{weights.change !== undefined && <small className={weights.change <= 0 ? "progress-positive" : ""}>{weights.change > 0 ? "+" : ""}{weights.change.toFixed(1)} kg since last entry</small>}</div>{weights.rollingAverage !== undefined && <p className="muted">7-entry average · {weights.rollingAverage.toFixed(1)} kg</p>}{weights.entries.length > 0 && <div className="progress-spark" aria-label="Recent weight history">{weights.entries.slice(-7).map(item => <span key={item.id} style={{ height: `${Math.max(12, Math.min(100, ((item.bodyweight ?? 0) / Math.max(...weights.entries.map(entry => entry.bodyweight ?? 1))) * 100))}%` }} title={`${item.date}: ${item.bodyweight} kg`} />)}</div>}<div className="progress-form"><label>Date<input type="date" value={weightDate} onChange={event => setWeightDate(event.target.value)} /></label><label>Weight (kg)<input inputMode="decimal" type="number" min="0" step="0.1" value={weight} onChange={event => setWeight(event.target.value)} placeholder="e.g. 82.4" /></label><button className="primary" type="button" onClick={addWeight}>Log weight</button></div>{weights.entries.length === 0 && <EmptyState title="Log your first weigh-in">A few consistent entries make your trend more useful.</EmptyState>} {weights.entries.slice().reverse().slice(0, 5).map(item => <div className="progress-entry" key={item.id}><span>{item.date}</span><strong>{item.bodyweight} kg</strong><button className="tertiary-button" type="button" onClick={() => commit(removeBodyMetric(data, item.id))}>Delete</button></div>)}</Surface>
    <Surface><div className="section-header"><div><span className="eyebrow">MEASUREMENTS</span><h2>Body measurements</h2></div></div><p className="muted">Measure under similar conditions, in the same position, with consistent tape tension.</p><div className="progress-form"><label>Measurement<select value={type} onChange={event => setType(event.target.value as BodyMeasurementType)}>{measurementTypes.map(item => <option value={item} key={item}>{measurementLabels[item]}</option>)}</select></label><label>Centimetres<input inputMode="decimal" type="number" min="0" step="0.1" value={value} onChange={event => setValue(event.target.value)} placeholder="e.g. 84" /></label><button className="primary" type="button" onClick={addMeasurement}>Add measurement</button></div><p className="caption">{measurementGuidance[type] ?? "Keep the tape level and use the same anatomical position each time."}</p><div className="measurement-grid">{measurementTypes.map(item => { const latest = latestMeasurement(data.bodyMetrics, item); const delta = measurementDelta(data.bodyMetrics, item); return <div className="metric-card" key={item}><span className="eyebrow">{measurementLabels[item]}</span><strong>{latest ? `${latest.value} cm` : "—"}</strong><small>{latest ? `${latest.date}${delta !== undefined ? ` · ${delta > 0 ? "+" : ""}${delta.toFixed(1)} cm` : ""}` : "Not logged"}</small></div>; })}</div><div className="progress-entry-list">{entries.slice(0, 8).map(item => <div className="progress-entry" key={item.id}><span>{measurementLabels[item.type]} · {item.date}</span><strong>{item.value} cm</strong><button className="tertiary-button" type="button" onClick={() => commit(removeBodyMetric(data, item.id.split(":")[0]))}>Delete</button></div>)}</div></Surface>
    <Surface><span className="eyebrow">STRENGTH</span><h2>Recent performance</h2>{bests.length ? bests.map(best => <div className="progress-entry" key={best.exerciseId}><span><strong>{best.exerciseName}</strong><small>Best working set · {best.date}</small></span><b>{best.weight} kg × {best.reps}</b></div>) : <EmptyState title="Strength progress will appear here">Complete working sets to build your record.</EmptyState>}<NavigationRow href="/personal-bests" label="View all personal bests" /></Surface>
    <Surface><span className="eyebrow">PHOTOS</span><h2>Progress photos</h2><p className="muted">{progressPhotoAvailability.message}</p><p className="caption">When private photo storage is connected, you&apos;ll be able to keep dated front, side and back views here.</p></Surface>
    <BackButton href="/training">Back to Training</BackButton><AppNav />
  </AppShell>;
}
