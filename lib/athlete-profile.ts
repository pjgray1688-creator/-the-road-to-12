import type { TrainingProfile } from "./training-profile";

export type AvailabilityMode = "fixed_days" | "flexible_week" | "variable_week" | "rotating_pattern" | "work_away" | "temporary_override";
export type AvailabilityPattern = { mode: AvailabilityMode; weekdays?: number[]; sessionsPerWeek?: number; cycle?: number[]; weekA?: number[]; weekB?: number[]; note?: string };
export type AvailabilityOverride = { startDate: string; endDate: string; availableDays?: number[]; sessionsPerWeek?: number; environment?: TrainingProfile["environment"]; sessionMinutes?: TrainingProfile["sessionMinutes"]; note?: string };
export type AthleteProfile = { id?: string; country?: string; locale?: string; dateOfBirth?: string; primaryGoal: TrainingProfile["goal"]; secondaryGoals: TrainingProfile["secondaryGoals"]; discipline: NonNullable<TrainingProfile["discipline"]>; experience: TrainingProfile["experience"]; trainingAgeYears?: number; competitiveStatus?: TrainingProfile["competitiveStatus"]; training: TrainingProfile; availability: AvailabilityPattern; temporaryOverrides?: AvailabilityOverride[] };

export function composeAthleteProfile(training: TrainingProfile, context: Partial<Omit<AthleteProfile, "training" | "primaryGoal" | "discipline" | "experience">> & { availability?: AvailabilityPattern; discipline?: AthleteProfile["discipline"] } = {}): AthleteProfile {
  return { ...context, training, primaryGoal: training.goal, secondaryGoals: training.secondaryGoals ?? [], discipline: context.discipline ?? training.discipline ?? (training.goal === "muscle_gain" ? "hypertrophy" : training.goal), experience: training.experience, availability: context.availability ?? { mode: training.availabilityMode ?? (training.preferredDays?.length ? "fixed_days" : "flexible_week"), weekdays: training.availableDays ?? training.preferredDays, sessionsPerWeek: training.daysPerWeek } };
}

export function availabilityForDate(athlete: AthleteProfile, date: string): AvailabilityOverride | AvailabilityPattern {
  const override = athlete.temporaryOverrides?.find(item => date >= item.startDate && date <= item.endDate);
  return override ?? athlete.availability;
}
