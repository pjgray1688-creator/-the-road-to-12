import type { Exercise } from "./types";
import type { TrainingProfile } from "./training-profile";

export type ExerciseRole = "primary_compound" | "secondary_compound" | "accessory_compound" | "isolation" | "core";

/** Derives a stable programming role from catalogue metadata and session position. */
export function exerciseRole(exercise: Exercise, position = 0): ExerciseRole {
  if (exercise.purpose === "core") return "core";
  if (exercise.purpose === "isolation") return "isolation";
  if (position === 0) return "primary_compound";
  if (position === 1) return "secondary_compound";
  return "accessory_compound";
}

function setCount(profile: TrainingProfile, role: ExerciseRole) {
  const short = profile.sessionMinutes <= 45;
  if (role === "core") return 2;
  if (role === "isolation") return profile.experience === "beginner" || short ? 2 : 3;
  if (role === "primary_compound") return profile.experience === "beginner" || short ? 3 : 4;
  if (role === "secondary_compound") return profile.experience === "beginner" || short ? 2 : 3;
  return profile.experience === "experienced" && !short ? 3 : 2;
}

/** Programme-level prescription. Loads are deliberately absent: Coach owns calibration. */
export function prescriptionForExercise(exercise: Exercise, profile: TrainingProfile, position = 0) {
  const role = exerciseRole(exercise, position);
  const sets = setCount(profile, role);
  if (role === "core") return { role, sets, target: `${sets} × 10–15` };
  if (role === "isolation") return { role, sets, target: `${sets} × ${profile.goal === "strength" ? "8–12" : "10–15"}` };
  if (role === "primary_compound") {
    if (profile.goal === "strength") return { role, sets, target: `${sets} × 4–6` };
    if (profile.goal === "muscle_gain") return { role, sets, target: `${sets} × 6–10` };
    return { role, sets, target: `${sets} × 6–10` };
  }
  if (role === "secondary_compound") return { role, sets, target: `${sets} × ${profile.goal === "strength" ? "5–8" : "8–12"}` };
  return { role, sets, target: `${sets} × ${profile.goal === "strength" ? "6–10" : "8–12"}` };
}
