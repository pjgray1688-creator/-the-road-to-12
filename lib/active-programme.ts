import { currentWeek } from "./domain";
import { loadData, loadGeneratedProgramme } from "./storage";
import type { PlannedSession } from "./domain";

/** Existing programmes remain the default; generated programmes opt in explicitly. */
export function activeWeek(): PlannedSession[] {
  if (typeof window === "undefined") return currentWeek;
  const base = loadGeneratedProgramme()?.week ?? currentWeek;
  const additions = loadData().salvageAdjustments ?? [];
  if (!additions.length) return base;
  const today = new Date().toISOString().slice(0, 10); const horizon = new Date(`${today}T12:00:00Z`); horizon.setUTCDate(horizon.getUTCDate() + 6); const end = horizon.toISOString().slice(0, 10);
  return base.map(session => { const extra = additions.filter(item => item.sessionId === session.id && (!item.scheduledDate || (item.scheduledDate >= today && item.scheduledDate <= end))); if (!extra.length) return session; const exerciseIds = [...session.exerciseIds]; for (const item of extra) if (!exerciseIds.includes(item.exerciseId)) exerciseIds.push(item.exerciseId); return { ...session, exerciseIds }; });
}
