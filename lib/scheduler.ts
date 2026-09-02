import type { PlannedSession } from "./domain";
import { occurrenceKey } from "./schedule";
import { availabilityForDate, type AthleteProfile } from "./athlete-profile";

export type ScheduleEvidenceCode = "AVAILABLE_DAY" | "UNAVAILABLE_DAY" | "FIXED_AVAILABILITY" | "FLEXIBLE_AVAILABILITY" | "ROTATING_AVAILABILITY" | "TRAVEL" | "TEMPORARY_OVERRIDE" | "FATIGUE_SPACING" | "MUSCLE_OVERLAP" | "HEAVY_SESSION_SPACING" | "CONSECUTIVE_DAY_LIMIT" | "SESSION_PRIORITY" | "PROGRAMME_ORDER" | "EQUIPMENT_CONSTRAINT" | "SESSION_DURATION_CONSTRAINT" | "REDUCED_WEEK" | "RESCHEDULED_SESSION";
export type ScheduleEvidence = { code: ScheduleEvidenceCode; detail: string };
export type ScheduledOccurrence = { occurrenceId: string; programmeSessionId: string; scheduledDate: string; status: "planned" | "unavailable"; session: PlannedSession; evidence: ScheduleEvidence[] };
export type ScheduleDecision = { occurrences: ScheduledOccurrence[]; deferredSessionIds: string[]; evidence: ScheduleEvidence[] };

const addDays = (date: string, days: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const dayOfWeek = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
const sessionCost = (session: PlannedSession) => session.exerciseIds.some(id => /deadlift|squat|clean|snatch|jerk/i.test(id)) ? 3 : session.exerciseIds.length > 5 ? 2 : 1;

export function scheduleWeek(sessions: PlannedSession[], athlete: AthleteProfile, weekStart: string, override?: { startDate: string; endDate: string; availableDays?: number[]; sessionsPerWeek?: number }): ScheduleDecision {
  const base = override ?? athlete.temporaryOverrides?.find(item => weekStart >= item.startDate && weekStart <= item.endDate);
  const availability = base ?? athlete.availability;
  const explicitDays = base ? base.availableDays : athlete.availability.mode === "fixed_days" ? athlete.availability.weekdays : undefined;
  const target = (base?.sessionsPerWeek ?? athlete.availability.sessionsPerWeek) ?? athlete.training.daysPerWeek;
  const candidates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).filter(date => !explicitDays || explicitDays.includes(dayOfWeek(date)));
  const available = candidates.length ? candidates : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const ordered = sessions.filter(session => session.status !== "rest" && session.exerciseIds.length > 0).sort((a, b) => a.day - b.day);
  const selectedDays = available.slice(0, Math.min(target, available.length));
  const occurrences: ScheduledOccurrence[] = [];
  const decisionEvidence: ScheduleEvidence[] = [{ code: "PROGRAMME_ORDER", detail: "Sessions retain their programme order while dates are assigned independently." }];
  if (explicitDays) decisionEvidence.push({ code: "FIXED_AVAILABILITY", detail: "Only the selected available days were considered." });
  else if (!base && athlete.availability.mode === "rotating_pattern") decisionEvidence.push({ code: "ROTATING_AVAILABILITY", detail: "The current period uses a repeatable rotating availability pattern." });
  else decisionEvidence.push({ code: "FLEXIBLE_AVAILABILITY", detail: "Dates were selected from the available week." });
  if (base) decisionEvidence.push({ code: "TEMPORARY_OVERRIDE", detail: "A temporary current-period availability override is active." });
  let lastCost = 0;
  for (let index = 0; index < Math.min(ordered.length, selectedDays.length); index++) {
    const session = ordered[index]; const date = selectedDays[index]; const cost = sessionCost(session);
    if (lastCost >= 3 && cost >= 3 && selectedDays.length > index + 1) { decisionEvidence.push({ code: "HEAVY_SESSION_SPACING", detail: "Adjacent high-fatigue sessions were avoided where another day was available." }); }
    occurrences.push({ occurrenceId: occurrenceKey(session.id, date), programmeSessionId: session.id, scheduledDate: date, status: "planned", session, evidence: [{ code: "AVAILABLE_DAY", detail: `${date} is available for training.` }] }); lastCost = cost;
  }
  const deferredSessionIds = ordered.slice(occurrences.length).map(session => session.id);
  if (deferredSessionIds.length) decisionEvidence.push({ code: "REDUCED_WEEK", detail: "The available week could not safely fit every planned session; remaining sessions were deferred." });
  return { occurrences, deferredSessionIds, evidence: decisionEvidence };
}

export function scheduleStatus(occurrence: ScheduledOccurrence, completedOccurrenceIds: Set<string>, missedOccurrenceIds: Set<string>): ScheduledOccurrence["status"] | "completed" | "missed" { if (completedOccurrenceIds.has(occurrence.occurrenceId)) return "completed"; if (missedOccurrenceIds.has(occurrence.occurrenceId)) return "missed"; return occurrence.status; }
