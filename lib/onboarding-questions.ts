import type { TrainingProfile } from "./training-profile";

export type BuilderQuestion = readonly [keyof TrainingProfile, string, readonly (readonly [string | number | boolean, string])[]];

/** Immutable answer domains. A selected answer is state, never an option source. */
export const builderQuestions = [
  ["availabilityMode", "How does your training availability usually work?", [["fixed_days", "Same days every week"], ["flexible_week", "Any days are fine"], ["variable_week", "My available days change"], ["rotating_pattern", "I work rotating shifts"], ["work_away", "I travel/work away regularly"], ["flexible_week", "I’ll decide later"]]],
  ["goal", "What are you training for?", [["fat_loss", "Fat loss / body composition"], ["muscle_gain", "Build muscle"], ["strength", "Build strength"], ["general_fitness", "General fitness"]]],
  ["experience", "How much training experience do you have?", [["beginner", "I’m new to structured training"], ["intermediate", "I’ve trained before"], ["experienced", "I’m experienced"]]],
  ["daysPerWeek", "How many days can you train?", [[2, "2 days"], [3, "3 days"], [4, "4 days"], [5, "5 days"], [6, "6 days"]]],
  ["sessionMinutes", "How long do you usually have?", [[45, "About 45 minutes"], [60, "About 60 minutes"], [75, "About 75 minutes"], [90, "75–90 minutes"]]],
  ["environment", "Where will you train?", [["full_gym", "Full gym"], ["limited_gym", "Limited gym"], ["home_basic", "Home / basic equipment"], ["bodyweight", "Bodyweight / minimal equipment"]]],
  ["priorities", "Anything you want to emphasise? (Optional)", [["balanced", "Keep it balanced"], ["chest", "Chest"], ["back_width", "Back"], ["glutes", "Glutes"], ["arms", "Arms"]]],
  ["wantedExercises", "Want a particular exercise included? (Optional)", [["", "No preference"], ["barbell-hip-thrust", "Barbell hip thrust"], ["bulgarian-split-squat", "Bulgarian split squat"]]],
  ["avoidedExercises", "Any exercise you'd rather avoid? (Optional)", [["", "No preference"], ["back-squat", "Barbell back squat"], ["leg-extension", "Leg extension"]]],
  ["conditioningPreference", "How should conditioning fit in?", [["post_workout", "After training"], ["separate_day", "Separate session"], ["mixed", "A mix"]]],
  ["includeCardio", "Would you like any extra conditioning?", [[true, "Yes, keep it manageable"], [false, "Not for now"]]],
] as const satisfies readonly BuilderQuestion[];

export function questionOptions(question: BuilderQuestion) { return question[2].slice(); }
