import type { ClubClassAvailability } from "./club-operations";

export type ClassAvailabilityPresentation = { summary: string; status: string; tone: "neutral" | "watch" | "low" | "full" | "unlimited"; fillPercent?: number };

export function presentClassAvailability(availability: ClubClassAvailability): ClassAvailabilityPresentation {
  if (availability.capacity === undefined || availability.spacesRemaining === undefined) return { summary: "No fixed capacity", status: "No fixed capacity", tone: "unlimited" };
  const summary = `${availability.capacity} spaces · ${availability.confirmedCount} booked`;
  const fillPercent = availability.capacity > 0 ? Math.min(100, Math.max(0, availability.confirmedCount / availability.capacity * 100)) : 100;
  if (availability.spacesRemaining === 0) return { summary, status: `Full${availability.waitlistedCount > 0 ? ` · ${availability.waitlistedCount} waiting` : ""}`, tone: "full", fillPercent };
  if (availability.spacesRemaining === 1) return { summary, status: "Last space", tone: "low", fillPercent };
  if (availability.spacesRemaining <= 4) return { summary, status: `Only ${availability.spacesRemaining} spaces left`, tone: "low", fillPercent };
  if (availability.spacesRemaining <= 9) return { summary, status: "Filling up", tone: "watch", fillPercent };
  return { summary, status: `${availability.spacesRemaining} spaces available`, tone: "neutral", fillPercent };
}
