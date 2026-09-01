import type { Exercise } from "./types";
import { exerciseKnowledge } from "./exercise-library";

export type ExerciseGuide = {
  name: string;
  setup: string;
  execution: string;
  cues: string[];
  primaryMuscles: string[];
  caution?: string;
  media?: Exercise["media"];
};

const aliases: Record<string, string> = {
  "machine-chest-press": "chest-press-machine",
  "rdl": "romanian-deadlift",
  "hamstring-curl": "seated-hamstring-curl",
  "hoist-roc-it-leg-extension": "leg-extension",
  "hip-thrust": "machine-hip-thrust",
  calves: "standing-calf-raise",
  "rear-delt-fly": "reverse-pec-deck",
  "incline-db-curl": "incline-db-curl",
  "hammer-curl": "hammer-curl",
  "pull-up-practice": "pull-up",
  "flat-bench": "flat-bench-press",
  "incline-machine-press": "incline-machine-press",
  "lateral-raise-mechanical-drop-set": "db-lateral-raise",
  "bayesian-cable-curl": "cable-curl",
  "ez-curl": "ez-bar-curl",
  "cross-body-single-arm-cable-lat-pulldown": "single-arm-lat-pulldown",
  "hoist-roc-it-row": "machine-row",
  "hip-adductor": "hip-adduction",
  "hip-abductor": "hip-abduction",
};

const cues: Record<string, string[]> = {
  "trap-bar-deadlift": ["Brace before you pull", "Keep the handles balanced", "Push the floor away"],
  "hack-squat": ["Keep your back against the pad", "Track knees over toes", "Control the bottom position"],
  "leg-press": ["Keep hips and lower back supported", "Use a pain-free depth", "Drive evenly through both feet"],
  "bulgarian-split-squat": ["Stay tall through the torso", "Keep the front foot planted", "Let the knee track naturally"],
  "incline-db-press": ["Set the shoulder blades first", "Lower with control", "Press without shrugging"],
  "lat-pulldown": ["Start with a tall chest", "Drive elbows toward your sides", "Avoid swinging"],
  "barbell-row": ["Hinge and brace", "Pull toward the lower ribs", "Keep the bar path controlled"],
  "cable-lateral-raise": ["Lead with the elbow", "Stop before the shoulder pinches", "Keep the torso still"],
};

export function guideForExercise(exercise: Exercise): ExerciseGuide | undefined {
  if (!exercise || exercise.id === "unknown") return undefined;
  const knowledge = exerciseKnowledge(aliases[exercise.id] ?? exercise.id);
  const muscle = knowledge?.primaryMuscles ?? (exercise.purpose === "core" ? ["core"] : ["target muscles"]);
  const pattern = knowledge?.movementPattern ?? "controlled resistance movement";
  const exerciseCues = cues[exercise.id] ?? [...(knowledge?.cautions ?? []), "Use a controlled range", "Keep the movement smooth"].slice(0, 3);
  return {
    name: exercise.name,
    setup: `Set up for the ${pattern} with a stable stance and a comfortable, pain-free position.`,
    execution: `Move under control, keep the target muscles engaged, and return smoothly to the start position.`,
    cues: exerciseCues,
    primaryMuscles: muscle,
    caution: knowledge?.cautions?.[0] ? `Use a pain-free range; watch for ${knowledge.cautions[0]}.` : "Stop and adjust the setup if you feel sharp pain.",
    media: exercise.media,
  };
}
