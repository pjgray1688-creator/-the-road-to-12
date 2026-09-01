import { currentBlock, currentWeek } from "./domain";
import type { GeneratedProgramme } from "./programme-generator";
import { defaultTrainingProfile } from "./training-profile";

/** Adapter that exposes the original fixed plan through the same programme contract. */
export function legacyProgrammeSnapshot(profile = defaultTrainingProfile): GeneratedProgramme {
  return { id: "legacy-personal-programme", name: currentBlock.name, profile, block: currentBlock, week: currentWeek, rationale: "Your original training plan, preserved as a recoverable programme.", isLegacy: true };
}
