"use client";
import { useMemo, useState } from "react";
import { searchExercises } from "@/lib/exercise-library";

export function ExerciseMultiSelect({ label, description, selected, onChange }: { label: string; description: string; selected: string[]; onChange: (values: string[]) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchExercises(query).slice(0, 12), [query]);
  const names = useMemo(() => new Map(searchExercises("").map(item => [item.id, item.name])), []);
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]); }
  return <section className="exercise-multi-select" aria-label={label}><label>{label}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search exercise, muscle or equipment" /></label><p className="muted">{description}</p>{selected.length ? <ul className="exercise-selection-list" aria-label="Selected exercises">{selected.map(id => <li key={id}><span>{names.get(id) ?? id}</span><button type="button" className="text-button" onClick={() => toggle(id)} aria-label={`Remove ${names.get(id) ?? id}`}>Remove</button></li>)}</ul> : <p className="muted">No exercises selected.</p>}<div className="exercise-search-results">{results.map(item => <button type="button" key={item.id} className={selected.includes(item.id) ? "selected" : ""} onClick={() => toggle(item.id)} aria-pressed={selected.includes(item.id)}>{selected.includes(item.id) ? "✓ " : "+ "}{item.name}<small>{item.primaryMuscles.join(", ")} · {item.equipmentRequired.join("/")}</small></button>)}</div></section>;
}
