"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import type { ClubClassSessionStatus, ClubClassSessionVisibility } from "@/lib/club-operations";

type ActionResult = { ok: true } | { ok: false; error: string };
type ClassTypeActionInput = { id?: string; name: string; description?: string; defaultDurationMinutes: number; defaultCapacity?: number; active: boolean };
type ClassSessionActionInput = { id?: string; locationId: string; classTypeId: string; hostUserId?: string; title?: string; startsAt: string; endsAt: string; capacity?: number; bookingOpensAt?: string; bookingClosesAt?: string; cancellationClosesAt?: string; visibility: ClubClassSessionVisibility; status: ClubClassSessionStatus };

async function actionContext() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return undefined;
  const context = await resolveClubOperationalContext(supabase, user.id);
  return context ? { ...context, userId: user.id } : undefined;
}

const positiveOptional = (value: number | undefined) => value === undefined || Number.isInteger(value) && value > 0;
const validDate = (value: string | undefined) => value === undefined || !Number.isNaN(Date.parse(value));

export async function saveClassTypeAction(input: ClassTypeActionInput): Promise<ActionResult> {
  try {
    const context = await actionContext();
    if (!context || !["gym_admin", "owner"].includes(context.role)) return { ok: false, error: "You don’t have permission to manage class types." };
    if (!input.name.trim() || !Number.isInteger(input.defaultDurationMinutes) || input.defaultDurationMinutes <= 0 || !positiveOptional(input.defaultCapacity)) return { ok: false, error: "Check the class type details and try again." };
    await context.repository.saveClassType({ id: input.id, organisationId: context.organisation.id, name: input.name.trim(), description: input.description?.trim() || undefined, defaultDurationMinutes: input.defaultDurationMinutes, defaultCapacity: input.defaultCapacity, active: input.active });
    revalidatePath("/club/classes"); return { ok: true };
  } catch (error) { console.error("[club-classes] class type save failed", { operation: error instanceof Error && "operation" in error ? error.operation : "save_class_type" }); return { ok: false, error: "Class changes couldn’t be saved." }; }
}

export async function saveClassSessionAction(input: ClassSessionActionInput): Promise<ActionResult> {
  try {
    const context = await actionContext();
    if (!context) return { ok: false, error: "You don’t have permission to manage this class." };
    const administrator = ["gym_admin", "owner"].includes(context.role);
    if (!administrator) {
      if (context.role !== "trainer" || !input.id) return { ok: false, error: "You don’t have permission to manage this class." };
      const existing = (await context.repository.listClassSessions(context.organisation.id)).find(session => session.id === input.id);
      if (!existing || existing.hostUserId !== context.userId || input.hostUserId !== context.userId) return { ok: false, error: "You don’t have permission to manage this class." };
    }
    if (!input.locationId || !input.classTypeId || !validDate(input.startsAt) || !validDate(input.endsAt) || Date.parse(input.endsAt) <= Date.parse(input.startsAt) || !positiveOptional(input.capacity) || !validDate(input.bookingOpensAt) || !validDate(input.bookingClosesAt) || !validDate(input.cancellationClosesAt)) return { ok: false, error: "Check the class schedule and try again." };
    await context.repository.saveClassSession({ id: input.id, organisationId: context.organisation.id, locationId: input.locationId, classTypeId: input.classTypeId, hostUserId: input.hostUserId, title: input.title?.trim() || undefined, startsAt: input.startsAt, endsAt: input.endsAt, capacity: input.capacity, bookingOpensAt: input.bookingOpensAt, bookingClosesAt: input.bookingClosesAt, cancellationClosesAt: input.cancellationClosesAt, visibility: input.visibility, status: input.status });
    revalidatePath("/club/classes"); return { ok: true };
  } catch (error) { console.error("[club-classes] class session save failed", { operation: error instanceof Error && "operation" in error ? error.operation : "save_class_session" }); return { ok: false, error: "Class changes couldn’t be saved." }; }
}
