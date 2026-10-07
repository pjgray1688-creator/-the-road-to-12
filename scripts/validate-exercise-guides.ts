import { validateExerciseGuideManifest } from "../lib/exercise-guides";

const errors = validateExerciseGuideManifest();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Exercise guide manifest valid.");
}
