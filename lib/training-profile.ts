export type TrainingGoal = "fat_loss" | "muscle_gain" | "strength" | "general_fitness";
export type TrainingExperience = "beginner" | "intermediate" | "experienced";
export type TrainingEnvironment = "full_gym" | "limited_gym" | "home_basic" | "bodyweight";
export type TrainingProfile = {
  goal: TrainingGoal;
  experience: TrainingExperience;
  daysPerWeek: 2 | 3 | 4 | 5 | 6;
  preferredDays?: number[];
  sessionMinutes: 45 | 60 | 75 | 90;
  environment: TrainingEnvironment;
  limitations: string[];
  dislikedExercises?: string[];
  includeCardio: boolean;
  cardioPreference?: "walking" | "cycling" | "rowing" | "mixed";
};

export const defaultTrainingProfile: TrainingProfile = { goal: "general_fitness", experience: "beginner", daysPerWeek: 3, sessionMinutes: 60, environment: "full_gym", limitations: [], dislikedExercises: [], includeCardio: true, cardioPreference: "walking" };
