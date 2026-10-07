import { exerciseLibrary, exerciseLibraryVersion, validateExerciseCatalogue } from "../lib/exercise-library";

const errors = validateExerciseCatalogue();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Exercise catalogue ${exerciseLibraryVersion}: ${exerciseLibrary.length} definitions valid`);
}
