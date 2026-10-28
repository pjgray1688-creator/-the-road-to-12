import type { BuilderProgramme } from "./coach-programme-builder";

export type ReviewerSet = { load: string; reps: string; rir: string; side?: "Left" | "Right" };
export type ReviewerExerciseLog = { name: string; substitution?: string; notes?: string; sets: ReviewerSet[] };
export type ReviewerWorkout = { id: string; date: string; name: string; exercises: ReviewerExerciseLog[] };
export type ReviewerSession = { id: string; type: "In-person PT" | "Online review" | "Completed coaching"; when: string; status: "Upcoming" | "Completed" };
export type ReviewerClient = {
  id: string;
  name: string;
  email: string;
  relationship: string;
  programmeName: string;
  nutritionStatus: string;
  weight: string;
  measurements: Array<{ date: string; weight: string; waist: string; note: string }>;
  personalBests: string[];
  workouts: ReviewerWorkout[];
  sessions: ReviewerSession[];
  progressUpdate: string;
};

export const foundationStrength: BuilderProgramme = {
  id: "reviewer-foundation-strength",
  name: "Foundation Strength",
  rationale: "Two-day strength programme.",
  week: [
    { id: "reviewer-lower", day: 1, name: "Lower strength", status: "planned", exerciseIds: ["trap-bar-deadlift", "leg-press", "romanian-deadlift"], exerciseOverrides: {
      "trap-bar-deadlift": { sets: 4, reps: "5", load: "RPE 7", restSeconds: 180 },
      "leg-press": { sets: 3, reps: "10", rir: 2, restSeconds: 120 },
      "romanian-deadlift": { sets: 3, reps: "8", rir: 2, restSeconds: 150 },
    }, structures: [{ id: "lower-straight", type: "straight", exerciseIds: ["trap-bar-deadlift"], settings: {} }, { id: "lower-superset", type: "superset", exerciseIds: ["leg-press", "romanian-deadlift"], settings: { rounds: 3, restBetweenExercisesSeconds: 30 } }] },
    { id: "reviewer-upper", day: 2, name: "Upper strength", status: "planned", exerciseIds: ["flat-bench", "barbell-row", "lat-pulldown"], exerciseOverrides: {
      "flat-bench": { sets: 4, reps: "6", load: "RPE 7", restSeconds: 150 },
      "barbell-row": { sets: 4, reps: "8", rir: 2, restSeconds: 120 },
      "lat-pulldown": { sets: 3, reps: "10", rir: 2, restSeconds: 90 },
    }, structures: [{ id: "upper-straight", type: "straight", exerciseIds: ["flat-bench"], settings: {} }, { id: "upper-superset", type: "superset", exerciseIds: ["barbell-row", "lat-pulldown"], settings: { rounds: 3, restBetweenExercisesSeconds: 30 } }] },
  ],
};

export const performanceBase: BuilderProgramme = {
  id: "reviewer-performance-base",
  name: "Performance Base",
  rationale: "Full-body template.",
  week: [{ id: "reviewer-full-body", day: 1, name: "Full body", status: "planned", exerciseIds: ["leg-press", "flat-bench", "barbell-row"], exerciseOverrides: {
    "leg-press": { sets: 4, reps: "8", rir: 2, restSeconds: 120 },
    "flat-bench": { sets: 3, reps: "8", rir: 2, restSeconds: 120 },
    "barbell-row": { sets: 3, reps: "10", rir: 2, restSeconds: 90 },
  }, structures: [{ id: "full-body-circuit", type: "circuit", exerciseIds: ["leg-press", "flat-bench", "barbell-row"], settings: { rounds: 3, restBetweenExercisesSeconds: 45 } }] }],
};

const recentWorkout = (id: string, name: string, date: string, load: string): ReviewerWorkout => ({
  id, name, date,
  exercises: [
    { name: "Trap-Bar Deadlift", notes: "Smooth final set.", sets: [{ load, reps: "5", rir: "2" }, { load, reps: "5", rir: "2" }, { load, reps: "5", rir: "1" }] },
    { name: "Leg Press", substitution: "Used sled leg press", sets: [{ load: "110 kg", reps: "10", rir: "2" }, { load: "110 kg", reps: "10", rir: "2" }, { load: "110 kg", reps: "9", rir: "1" }] },
  ],
});

export const reviewerClients: ReviewerClient[] = [
  {
    id: "reviewer-alex", name: "Alex Taylor", email: "alex.taylor@example.invalid", relationship: "Independent client", programmeName: "Foundation Strength", nutritionStatus: "Performance foundations · active", weight: "82.4 kg",
    measurements: [{ date: "18 Oct 2026", weight: "82.4 kg", waist: "84 cm", note: "Down 0.6 kg this month" }, { date: "20 Sep 2026", weight: "83.0 kg", waist: "85 cm", note: "Baseline review" }],
    personalBests: ["Trap-bar deadlift · 140 kg × 3", "Flat bench press · 82.5 kg × 5"],
    workouts: [recentWorkout("alex-workout-1", "Lower Strength", "21 Oct 2026", "120 kg")],
    sessions: [{ id: "alex-session-1", type: "In-person PT", when: "Today · 18:00–19:00", status: "Upcoming" }, { id: "alex-session-2", type: "Completed coaching", when: "21 Oct · Lower Strength", status: "Completed" }],
    progressUpdate: "Lower-body strength is progressing while weekly volume remains controlled.",
  },
  {
    id: "reviewer-sophie", name: "Sophie Bennett", email: "sophie.bennett@example.invalid", relationship: "Online coaching", programmeName: "Full Body Strength", nutritionStatus: "Balanced performance · active", weight: "67.8 kg",
    measurements: [{ date: "19 Oct 2026", weight: "67.8 kg", waist: "72 cm", note: "Progress update received" }, { date: "21 Sep 2026", weight: "68.2 kg", waist: "73 cm", note: "Previous check-in" }],
    personalBests: ["Goblet squat · 32 kg × 10", "Lat pulldown · 55 kg × 8"],
    workouts: [recentWorkout("sophie-workout-1", "Full Body Strength", "20 Oct 2026", "90 kg")],
    sessions: [{ id: "sophie-session-1", type: "Online review", when: "Friday · 17:30–18:00", status: "Upcoming" }],
    progressUpdate: "Recent check-in shows consistent training and improved exercise confidence.",
  },
  {
    id: "reviewer-daniel", name: "Daniel Brooks", email: "daniel.brooks@example.invalid", relationship: "Independent client", programmeName: "Hypertrophy Build", nutritionStatus: "Maintenance phase · active", weight: "88.1 kg",
    measurements: [{ date: "17 Oct 2026", weight: "88.1 kg", waist: "89 cm", note: "Programme review due" }, { date: "17 Sep 2026", weight: "87.5 kg", waist: "89 cm", note: "Previous review" }],
    personalBests: ["Barbell row · 85 kg × 8", "Leg press · 180 kg × 10"],
    workouts: [recentWorkout("daniel-workout-1", "Upper Hypertrophy", "22 Oct 2026", "125 kg"), recentWorkout("daniel-workout-2", "Lower Hypertrophy", "18 Oct 2026", "120 kg")],
    sessions: [{ id: "daniel-session-1", type: "Online review", when: "Monday · Programme review", status: "Upcoming" }],
    progressUpdate: "Training history is consistent; next programme block review is due.",
  },
  {
    id: "reviewer-emma", name: "Emma Clarke", email: "emma.clarke@example.invalid", relationship: "Independent client", programmeName: "General Fitness", nutritionStatus: "Everyday energy · active", weight: "71.2 kg",
    measurements: [{ date: "20 Oct 2026", weight: "71.2 kg", waist: "76 cm", note: "Measurements updated" }, { date: "22 Sep 2026", weight: "72.0 kg", waist: "77 cm", note: "Starting point" }],
    personalBests: ["Romanian deadlift · 70 kg × 8", "Leg press · 120 kg × 12"],
    workouts: [recentWorkout("emma-workout-1", "General Fitness", "19 Oct 2026", "80 kg")],
    sessions: [{ id: "emma-session-1", type: "In-person PT", when: "Saturday · 10:00–11:00", status: "Upcoming" }],
    progressUpdate: "Current measurements and attendance show steady progress.",
  },
];

export const reviewerProgrammes = [foundationStrength, performanceBase];
