import { currentWeek } from "./domain";
import { loadGeneratedProgramme } from "./storage";
import type { PlannedSession } from "./domain";

/** Existing programmes remain the default; generated programmes opt in explicitly. */
export function activeWeek(): PlannedSession[] {
  if (typeof window === "undefined") return currentWeek;
  return loadGeneratedProgramme()?.week ?? currentWeek;
}
