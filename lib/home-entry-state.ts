export type HomeEntryView = "programme_invitation" | "loading" | "workouts_unavailable" | "dashboard";

/** Keep the fresh-account Home available even if unrelated workout hydration stalls. */
export function homeEntryView(hasProgramme: boolean, workoutsReady: boolean, workoutsFailed = false): HomeEntryView {
  if (!hasProgramme) return "programme_invitation";
  if (workoutsFailed) return "workouts_unavailable";
  return workoutsReady ? "dashboard" : "loading";
}
