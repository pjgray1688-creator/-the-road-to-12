import type { CardioModality, CardioSession } from "./domain";

export type CardioModalityDefinition = { id: CardioModality; name: string; metrics: string[]; lowerBodyDemand: "low" | "medium" | "high"; kneeDemand: "low" | "medium" | "high" };
export const cardioModalities: CardioModalityDefinition[] = [
  { id: "incline_treadmill", name: "Incline treadmill", metrics: ["duration", "incline", "speed"], lowerBodyDemand: "medium", kneeDemand: "medium" },
  { id: "stairmaster", name: "StairMaster / stair climber", metrics: ["duration", "level"], lowerBodyDemand: "high", kneeDemand: "high" },
  { id: "upright_bike", name: "Upright stationary bike", metrics: ["duration", "resistance", "cadence", "watts"], lowerBodyDemand: "medium", kneeDemand: "medium" },
  { id: "recumbent_bike", name: "Recumbent bike", metrics: ["duration", "resistance", "cadence", "watts"], lowerBodyDemand: "low", kneeDemand: "low" },
  { id: "elliptical", name: "Elliptical / cross-trainer", metrics: ["duration", "resistance", "incline"], lowerBodyDemand: "medium", kneeDemand: "low" },
  { id: "rower", name: "Rowing machine", metrics: ["duration", "pace500m", "strokeRate"], lowerBodyDemand: "medium", kneeDemand: "medium" }
];
export type CardioChoice = { modality: CardioModality; duration: number; settings: Record<string, number>; why: string };
export function prescribeCardio(modality: CardioModality = "incline_treadmill", input: { lowerBodyFatigue?: boolean; poorRecovery?: boolean; kneeConcern?: boolean } = {}): CardioChoice {
  if (modality === "incline_treadmill") { const reduced = input.lowerBodyFatigue || input.poorRecovery || input.kneeConcern; return { modality, duration: reduced ? 35 : 40, settings: { incline: reduced ? 6 : 8, speed: reduced ? 4.8 : 5 }, why: reduced ? "Keep conditioning steady while protecting recovery." : "Complete the standard conditioning block." }; }
  if (modality === "stairmaster") return { modality, duration: 30, settings: {}, why: "Use a conservative starting level and learn your tolerance." };
  if (modality === "recumbent_bike") return { modality, duration: 40, settings: { resistance: 4 }, why: "A lower-impact option for steady conditioning." };
  if (modality === "upright_bike") return { modality, duration: 35, settings: { resistance: 4 }, why: "Keep cycling controlled and conversational." };
  if (modality === "elliptical") return { modality, duration: 35, settings: { resistance: 5 }, why: "Use smooth, low-impact conditioning." };
  return { modality, duration: 30, settings: {}, why: "Keep the row controlled; damper is not a proxy for intensity." };
}
export function saveCardioSession(session: CardioSession, data: import("./types").AppData) { return { ...data, cardioSessions: [...(data.cardioSessions ?? []), session] }; }
