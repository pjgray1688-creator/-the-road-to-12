type WorkoutState = { status?: string; completedAt?: string };

/** Normalises the workout API envelope used by both current and legacy clients. */
export function activeWorkoutsFromPayload(payload: unknown): WorkoutState[] {
  const items = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as { workouts?: unknown }).workouts) ? (payload as { workouts: unknown[] }).workouts : payload && typeof payload === "object" && Array.isArray((payload as { sessions?: unknown }).sessions) ? (payload as { sessions: unknown[] }).sessions : [];
  return items.filter((item): item is WorkoutState => Boolean(item && typeof item === "object" && ((item as WorkoutState).status === "active" || (!(item as WorkoutState).status && !(item as WorkoutState).completedAt))));
}
