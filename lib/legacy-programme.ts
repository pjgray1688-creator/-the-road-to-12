import { currentBlock, currentWeek } from "./domain";
import type { GeneratedProgramme } from "./programme-generator";
import { defaultTrainingProfile } from "./training-profile";

/** Preserves the original plan only for accounts explicitly assigned the legacy programme by server state. */
export function legacyProgrammeSnapshot(profile = defaultTrainingProfile): GeneratedProgramme {
  return { id: "legacy-personal-programme", name: currentBlock.name, profile, block: currentBlock, week: currentWeek, rationale: "Your original training plan, preserved as a recoverable programme.", isLegacy: true };
}
