import type { AppData, Cardio, LoggedSet, Workout } from "./types";
import { loadData } from "./storage";

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Workout persistence unavailable");
  return payload;
}

export async function fetchServerWorkouts(): Promise<Workout[]> {
  const payload = await responseJson(await fetch("/api/workouts", { credentials: "same-origin" }));
  return Array.isArray(payload.workouts) ? payload.workouts : Array.isArray(payload.sessions) ? payload.sessions : [];
}

/** Cache server state without destroying a richer local record that is still awaiting import. */
export function cacheServerWorkouts(serverWorkouts: Workout[]) {
  const local = loadData();
  const byId = new Map(local.workouts.map(workout => [workout.id, workout]));
  for (const server of serverWorkouts) {
    const existing = byId.get(server.id);
    if (existing && existing.sets.length > server.sets.length && server.sets.length === 0) continue;
    byId.set(server.id, server);
  }
  const next: AppData = { ...local, workouts: [...byId.values()] };
  const current = local.workouts;
  if (JSON.stringify(current) !== JSON.stringify(next.workouts)) {
    localStorage.setItem("road-to-12-data-v1", JSON.stringify(next));
  }
}

export async function importLocalWorkouts(includeTestData = false) {
  const local = loadData();
  const workouts = local.workouts.filter(workout => includeTestData || workout.origin !== "test");
  if (!workouts.length) return [];
  const payload = await responseJson(await fetch("/api/workouts/import", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ workouts, includeTestData }) }));
  return payload.results ?? [];
}

export async function createOrResumeServerWorkout(workout: Workout) {
  const payload = await responseJson(await fetch("/api/workouts", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(workout) }));
  const row = payload.session;
  if (!row) throw new Error("Workout session could not be created");
  const canonical = { ...workout, id: row.id, status: row.status, completedAt: row.completed_at ?? workout.completedAt, serverVersion: row.version } as Workout;
  if (!row.id) return canonical;
  const detail = await fetch(`/api/workouts/${row.id}`, { credentials: "same-origin" });
  if (!detail.ok) return canonical;
  const complete = await detail.json();
  return complete.workout ?? canonical;
}

export async function persistSet(workout: Workout, set: LoggedSet) {
  const payload = await responseJson(await fetch(`/api/workouts/${workout.id}/sets`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ set, setOrder: workout.sets.findIndex(item => item.id === set.id) }) }));
  return payload.set;
}

export async function persistCardio(workout: Workout, cardio: Cardio) {
  return responseJson(await fetch(`/api/workouts/${workout.id}/cardio`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(cardio) }));
}

export async function completeServerWorkout(workout: Workout) {
  const payload = await responseJson(await fetch(`/api/workouts/${workout.id}/complete`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: workout.serverVersion, completedAt: workout.completedAt }) }));
  return payload.session;
}
