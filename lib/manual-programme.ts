import type { PlannedSession } from "./domain";
import type { Exercise } from "./types";
import type { GeneratedProgramme } from "./programme-generator";
import type { TrainingProfile } from "./training-profile";

export function createManualProgramme(name: string, sessions: PlannedSession[], profile: TrainingProfile, id = `manual-${crypto.randomUUID()}`): GeneratedProgramme {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 80) throw new Error("Programme name must be 1–80 characters.");
  if (!sessions.length || sessions.length > 7) throw new Error("Add between one and seven training days.");
  const ids = new Set<string>();
  const week = sessions.map((session, index) => {
    const dayId = session.id || `manual-session-${crypto.randomUUID()}`;
    if (ids.has(dayId)) throw new Error("Training day IDs must be unique."); ids.add(dayId);
    const exerciseIds = session.exerciseIds.filter((value, i, all) => all.indexOf(value) === i);
    return { ...session, id: dayId, day: index + 1, name: session.name.trim() || `Day ${index + 1}`, exerciseIds, status: "planned" as const };
  });
  const today = new Date().toISOString().slice(0, 10);
  return { id, name: cleanName, profile, week, framework: "manual", generationVersion: "manual-v1", rationale: "Built by you using the R12 exercise library.", block: { id: `${id}-block`, name: cleanName, startDate: today, endDate: new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10), weekNumber: 1, totalWeeks: 4, goals: [profile.goal], progressionFocus: "Progress at your own pace with consistent, comfortable technique.", status: "proposed", reviewDate: today } };
}

export function customExercise(name: string, equipment: Exercise["equipment"] = "machine"): Exercise {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error("Exercise name must be 1–80 characters.");
  const slug = trimmed.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "exercise";
  return { id: `custom-${slug}-${crypto.randomUUID().slice(0, 8)}`, name: trimmed, target: "8–12 reps", sets: 3, restSeconds: 90, purpose: "hypertrophy", equipment, defaultWorkingWeight: 0 };
}
