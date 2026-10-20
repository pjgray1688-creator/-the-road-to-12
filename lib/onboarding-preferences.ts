import type { AppData } from "./types";
import { defaultTrainingProfile, type TrainingProfile } from "./training-profile";

/** Reuse this account's saved training and availability choices when reopening the builder. */
export function trainingProfileForBuilder(data: Pick<AppData, "trainingProfile" | "generatedProgramme" | "athleteProfile">): TrainingProfile {
  const saved = data.trainingProfile ?? data.generatedProgramme?.profile ?? defaultTrainingProfile;
  const availability = data.athleteProfile?.availability;
  if (!availability) return saved;
  return {
    ...saved,
    availabilityMode: availability.mode === "temporary_override" ? saved.availabilityMode : availability.mode,
    availableDays: availability.mode === "fixed_days" ? availability.weekdays : undefined,
    daysPerWeek: [2, 3, 4, 5, 6].includes(availability.sessionsPerWeek ?? 0) ? availability.sessionsPerWeek as TrainingProfile["daysPerWeek"] : saved.daysPerWeek,
  };
}
