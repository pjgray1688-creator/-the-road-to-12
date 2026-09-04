import type { PlannedSession, SessionStatus } from "./domain";
import type { AppData } from "./types";
import { composeAthleteProfile } from "./athlete-profile";
import { scheduleWeek, scheduleStatus, type ScheduledOccurrence } from "./scheduler";
import { occurrenceDateForDay, occurrenceKey, localDateParts } from "./schedule";
import { defaultTrainingProfile } from "./training-profile";

export type ProductOccurrence = Omit<ScheduledOccurrence, "status"> & { status: "planned" | "completed" | "partial" | "missed" | "unavailable" | "rescheduled" | "rest"; active: boolean };
const monday = (date: string) => { const d = new Date(`${date}T12:00:00Z`); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); return d.toISOString().slice(0, 10); };
export function resolveWeekSchedule(sessions: PlannedSession[], data: AppData, timezone: string, date = new Date()): { occurrences: ProductOccurrence[]; deferredSessionIds: string[]; evidence: ReturnType<typeof scheduleWeek>["evidence"] } {
  const local = localDateParts(date, timezone); const athlete = data.athleteProfile ?? (data.trainingProfile ? composeAthleteProfile(data.trainingProfile) : undefined);
  // The legacy Original programme is a dated seven-day plan. Availability can
  // shape generated programmes, but must never repack Original sessions or
  // let an ad-hoc/catch-up workout consume the next canonical occurrence.
  const originalProgramme = !data.generatedProgramme;
  const scheduled = athlete && !originalProgramme ? scheduleWeek(sessions, athlete, monday(local.date)) : { occurrences: sessions.filter(s => s.status !== "rest" && s.exerciseIds.length).map(s => ({ occurrenceId: occurrenceKey(s.id, occurrenceDateForDay(date, timezone, s.day)), programmeSessionId: s.id, scheduledDate: occurrenceDateForDay(date, timezone, s.day), status: "planned" as const, session: s, evidence: [] })), deferredSessionIds: [], evidence: [] };
  const completed = new Set(data.workouts.filter(w => w.status === "completed" && w.plannedSessionId && w.scheduledDate).map(w => occurrenceKey(w.plannedSessionId!, w.scheduledDate!)));
  const partial = new Set(data.workouts.filter(w => w.status === "partial" && w.plannedSessionId && w.scheduledDate).map(w => occurrenceKey(w.plannedSessionId!, w.scheduledDate!)));
  const overrides = data.sessionStatusOverrides ?? {};
  const salvage = data.salvageAdjustments ?? [];
  const occurrences = scheduled.occurrences.map(item => { const key = item.occurrenceId; const legacyKey = `${item.programmeSessionId}:${item.scheduledDate}`; const elapsed = item.status === "planned" && item.scheduledDate < local.date ? "missed" : item.status; const status = overrides[key]?.status ?? (completed.has(key) || completed.has(legacyKey) ? "completed" : partial.has(key) || partial.has(legacyKey) ? "partial" : elapsed); const additions = salvage.filter(adjustment => adjustment.scheduledDate === item.scheduledDate && adjustment.sessionId === item.programmeSessionId); const session = additions.length ? { ...item.session, exerciseIds: [...item.session.exerciseIds, ...additions.map(adjustment => adjustment.exerciseId).filter(id => !item.session.exerciseIds.includes(id))] } : item.session; return { ...item, session, status: status as ProductOccurrence["status"], active: item.scheduledDate === local.date }; });
  return { occurrences, deferredSessionIds: scheduled.deferredSessionIds, evidence: scheduled.evidence };
}

/** Canonical dated occurrences for the current product week. Consumers should not rebuild dates from weekday fields. */
export function resolveCurrentWeekSchedule(sessions: PlannedSession[], data: AppData, timezone: string, date = new Date()) {
  return resolveWeekSchedule(sessions, data, timezone, date);
}

export function resolveTodayOccurrence(sessions: PlannedSession[], data: AppData, timezone: string, date = new Date()) { const schedule = resolveWeekSchedule(sessions, data, timezone, date); const active = schedule.occurrences.find(item => item.active); if (active) return active; const local = localDateParts(date, timezone); const rest = sessions.find(session => session.day === local.day && (session.status === "rest" || session.exerciseIds.length === 0)); return rest ? { occurrenceId: occurrenceKey(rest.id, occurrenceDateForDay(date, timezone, rest.day)), programmeSessionId: rest.id, scheduledDate: occurrenceDateForDay(date, timezone, rest.day), status: "rest" as const, session: rest, evidence: [], active: true } : schedule.occurrences[0]; }

export function occurrenceStatus(data: AppData, sessionId: string, scheduledDate: string): SessionStatus | undefined { return data.sessionStatusOverrides?.[occurrenceKey(sessionId, scheduledDate)]?.status; }
