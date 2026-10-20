import type { AppData } from "./types";
import { defaultTrainingProfile, type TrainingProfile } from "./training-profile";

export function trainingProfileForBuilder(data: Pick<AppData, "trainingProfile" | "generatedProgramme" | "athleteProfile">): TrainingProfile {
  const saved = data.trainingProfile ?? data.generatedProgramme?.profile ?? defaultTrainingProfile;
  const availability = data.athleteProfile?.availability;
  if (!availability) return saved;
  const frequency = availability.sessionsPerWeek;
  return {
    ...saved,
    availabilityMode: availability.mode === "temporary_override" ? saved.availabilityMode : availability.mode,
    availableDays: availability.mode === "fixed_days" ? availability.weekdays : undefined,
    daysPerWeek: [2, 3, 4, 5, 6].includes(frequency ?? 0) ? frequency as TrainingProfile["daysPerWeek"] : saved.daysPerWeek,
  };
}
