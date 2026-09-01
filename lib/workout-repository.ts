import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Cardio, LoggedSet, Workout } from "./types";

export type WorkoutSessionRow = {
  id: string; user_id: string; planned_session_id: string | null; scheduled_date: string | null;
  status: "active" | "completed"; name: string; workout_type: string | null; started_at: string;
  completed_at: string | null; origin: "real" | "historical" | "test"; source: string;
  version: number; metadata: Record<string, unknown>; created_at: string; updated_at: string;
};

export function serverSessionToWorkout(session: WorkoutSessionRow & { metadata?: Record<string, unknown> }, sets: Array<Record<string, unknown>> = [], cardio?: Record<string, unknown> | null): Workout {
  const metadata = session.metadata ?? {};
  return {
    id: session.id, name: session.name, startedAt: session.started_at, completedAt: session.completed_at ?? undefined,
    plannedSessionId: session.planned_session_id ?? undefined, scheduledDate: session.scheduled_date ?? undefined,
    status: session.status, serverVersion: session.version, origin: session.origin,
    substitutions: (metadata.substitutions as Record<string, string> | undefined) ?? {}, notes: (metadata.notes as string[] | undefined) ?? [], provenance: (metadata.provenance as Workout["provenance"] | undefined) ?? undefined, recoveryEvidence: (metadata.recoveryEvidence as Workout["recoveryEvidence"] | undefined) ?? undefined,
    sets: sets.map(item => ({ id: String(item.id), exerciseId: String(item.exercise_id), exerciseName: String(item.exercise_name), weight: Number(item.weight ?? 0), reps: Number(item.reps ?? 0), kind: item.kind as LoggedSet["kind"], rir: item.rir == null ? undefined : Number(item.rir), createdAt: String(item.created_at ?? new Date().toISOString()), ...(item.side ? { side: String(item.side) } : {}), ...(item.feedback ? { feedback: String(item.feedback) } : {}) })),
    ...(cardio ? { cardio: { modality: cardio.modality as Cardio["modality"], duration: Number(cardio.duration ?? 0), completedAt: cardio.completed_at ? String(cardio.completed_at) : undefined, settings: { ...((cardio.actual_settings as Record<string, number | string> | null) ?? {}) } } } : {}),
  };
}

export type RepositoryError = Error & { code?: string; operation?: string };
const fail = (message: string, operation: string, code?: string): never => { const error = new Error(message) as RepositoryError; error.operation = operation; error.code = code; throw error; };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidOrNew = (value: string) => uuidPattern.test(value) ? value : randomUUID();

/** Stable identity used by imports and cross-device reconciliation. */
export function canonicalSessionKey(workout: Pick<Workout, "plannedSessionId" | "scheduledDate">) {
  return workout.plannedSessionId && workout.scheduledDate ? `${workout.plannedSessionId}:${workout.scheduledDate}` : null;
}
export function isImportableWorkout(workout: Pick<Workout, "origin">) { return workout.origin !== "test"; }
export function shouldPreferIncoming(existingSetCount: number, incomingSetCount: number) {
  return incomingSetCount > 0 && existingSetCount === 0;
}

function sessionRow(workout: Workout, userId: string, version = 1) {
  return {
    id: uuidOrNew(workout.id), user_id: userId, planned_session_id: workout.plannedSessionId ?? null,
    scheduled_date: workout.scheduledDate ?? null, status: workout.status ?? (workout.completedAt ? "completed" : "active"),
    name: workout.name, workout_type: "strength", started_at: workout.startedAt, completed_at: workout.completedAt ?? null,
    origin: workout.origin ?? "real", source: "app", version,
    metadata: { substitutions: workout.substitutions ?? {}, notes: workout.notes ?? [], ...(workout.provenance ? { provenance: workout.provenance } : {}), ...(workout.recoveryEvidence ? { recoveryEvidence: workout.recoveryEvidence } : {}) }, updated_at: new Date().toISOString(),
  };
}

function setRows(workout: Workout, userId: string) {
  return workout.sets.map((set, index) => ({
    id: set.id, user_id: userId, session_id: workout.id, exercise_id: set.exerciseId, exercise_name: set.exerciseName,
    exercise_order: typeof (set as LoggedSet & { exerciseOrder?: number }).exerciseOrder === "number" ? (set as LoggedSet & { exerciseOrder?: number }).exerciseOrder : null,
    set_order: index, kind: set.kind, weight: set.weight, reps: set.reps, rir: set.kind === "working" ? (set.rir ?? null) : null,
    side: (set as LoggedSet & { side?: string }).side ?? null, feedback: (set as LoggedSet & { feedback?: string }).feedback ?? null,
    metadata: {}, updated_at: new Date().toISOString(),
  }));
}

function cardioRow(cardio: Cardio, sessionId: string, userId: string) {
  return { user_id: userId, session_id: sessionId, modality: cardio.modality ?? "incline-treadmill", duration: cardio.duration,
    completed: Boolean(cardio.completedAt), prescribed_settings: cardio.settings ?? {}, actual_settings: cardio.settings ?? {},
    completed_at: cardio.completedAt ?? null, updated_at: new Date().toISOString() };
}

export async function listWorkoutSessions(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("workout_sessions").select("*").eq("user_id", userId).order("scheduled_date", { ascending: false });
  if (error) fail(error.message, "list_sessions", error.code); return data as WorkoutSessionRow[];
}

export async function listCompleteWorkouts(client: SupabaseClient, userId: string) {
  const sessions = await listWorkoutSessions(client, userId);
  const complete = await Promise.all(sessions.map(async session => {
    const result = await getWorkoutSession(client, userId, session.id);
    return result ? serverSessionToWorkout(result.session as WorkoutSessionRow, result.sets as Array<Record<string, unknown>>, result.cardio as Record<string, unknown> | null) : null;
  }));
  return complete.filter((item): item is Workout => Boolean(item));
}

export async function getWorkoutSession(client: SupabaseClient, userId: string, id: string) {
  const { data: session, error } = await client.from("workout_sessions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) fail(error.message, "get_session", error.code); if (!session) return null;
  const [{ data: sets, error: setsError }, { data: cardio, error: cardioError }] = await Promise.all([
    client.from("workout_sets").select("*").eq("session_id", id).eq("user_id", userId).order("set_order"),
    client.from("workout_cardio").select("*").eq("session_id", id).eq("user_id", userId).maybeSingle(),
  ]);
  if (setsError) fail(setsError.message, "get_sets", setsError.code); if (cardioError) fail(cardioError.message, "get_cardio", cardioError.code);
  return { session, sets: sets ?? [], cardio: cardio ?? null };
}

export async function createOrResumeWorkout(client: SupabaseClient, userId: string, workout: Workout) {
  if (!workout.plannedSessionId || !workout.scheduledDate) {
    const { data, error } = await client.from("workout_sessions").insert(sessionRow(workout, userId)).select().single();
    if (error) fail(error.message, "create_session", error.code); return { session: data, resumed: false };
  }
  const { data: existing, error: lookupError } = await client.from("workout_sessions").select("*").eq("user_id", userId).eq("planned_session_id", workout.plannedSessionId).eq("scheduled_date", workout.scheduledDate).maybeSingle();
  if (lookupError) fail(lookupError.message, "lookup_session", lookupError.code);
  if (existing) return { session: existing, resumed: true };
  const { data, error } = await client.from("workout_sessions").insert(sessionRow(workout, userId)).select().single();
  if (error) { if (error.code === "23505") { const retry = await client.from("workout_sessions").select("*").eq("user_id", userId).eq("planned_session_id", workout.plannedSessionId).eq("scheduled_date", workout.scheduledDate).single(); if (!retry.error) return { session: retry.data, resumed: true }; } fail(error.message, "create_session", error.code); }
  return { session: data, resumed: false };
}

export async function upsertWorkoutSet(client: SupabaseClient, userId: string, workoutId: string, set: LoggedSet, setOrder: number, allowCompleted = false) {
  await assertSessionActive(client, userId, workoutId, allowCompleted);
  const row = { id: uuidOrNew(set.id), user_id: userId, session_id: workoutId, exercise_id: set.exerciseId, exercise_name: set.exerciseName, set_order: setOrder, kind: set.kind, weight: set.weight, reps: set.reps, rir: set.kind === "working" ? (set.rir ?? null) : null, side: (set as LoggedSet & { side?: string }).side ?? null, feedback: (set as LoggedSet & { feedback?: string }).feedback ?? null, metadata: {}, updated_at: new Date().toISOString() };
  const { data, error } = await client.from("workout_sets").upsert(row, { onConflict: "id" }).select().single();
  if (error) fail(error.message, "upsert_set", error.code); return data;
}
export async function deleteWorkoutSet(client: SupabaseClient, userId: string, workoutId: string, setId: string) {
  await assertSessionActive(client, userId, workoutId);
  const { error } = await client.from("workout_sets").delete().eq("id", setId).eq("session_id", workoutId).eq("user_id", userId);
  if (error) fail(error.message, "delete_set", error.code);
  return { deleted: setId };
}

export async function upsertWorkoutCardio(client: SupabaseClient, userId: string, workoutId: string, cardio: Cardio) {
  await assertSessionActive(client, userId, workoutId);
  const { data, error } = await client.from("workout_cardio").upsert(cardioRow(cardio, workoutId, userId), { onConflict: "session_id" }).select().single();
  if (error) fail(error.message, "upsert_cardio", error.code); return data;
}

export async function completeWorkout(client: SupabaseClient, userId: string, workoutId: string, completedAt: string, expectedVersion?: number) {
  let query = client.from("workout_sessions").update({ status: "completed", completed_at: completedAt, updated_at: new Date().toISOString(), version: (expectedVersion ?? 1) + 1 }).eq("id", workoutId).eq("user_id", userId).eq("status", "active");
  if (expectedVersion !== undefined) query = query.eq("version", expectedVersion);
  const { data, error } = await query.select().maybeSingle();
  if (error) fail(error.message, "complete_session", error.code); if (!data) fail("Session is already completed or has changed", "complete_session", "WORKOUT_CONFLICT"); return data;
}

export async function updateWorkoutSession(client: SupabaseClient, userId: string, workoutId: string, changes: { name?: string; metadata?: Record<string, unknown>; expectedVersion?: number }) {
  const nextVersion = (changes.expectedVersion ?? 1) + 1;
  let query = client.from("workout_sessions").update({ ...(changes.name === undefined ? {} : { name: changes.name }), ...(changes.metadata === undefined ? {} : { metadata: changes.metadata }), version: nextVersion, updated_at: new Date().toISOString() }).eq("id", workoutId).eq("user_id", userId);
  if (changes.expectedVersion !== undefined) query = query.eq("version", changes.expectedVersion);
  const { data, error } = await query.select().maybeSingle();
  if (error) fail(error.message, "update_session", error.code); if (!data) fail("Session has changed or does not exist", "update_session", "WORKOUT_CONFLICT"); return data;
}

export async function discardActiveWorkout(client: SupabaseClient, userId: string, workoutId: string) {
  const { data: session, error: lookupError } = await client.from("workout_sessions").select("status, origin").eq("id", workoutId).eq("user_id", userId).maybeSingle();
  if (lookupError) fail(lookupError.message, "discard_lookup", lookupError.code);
  if (!session) fail("Workout session not found", "discard_lookup", "NOT_FOUND");
  if ((session as { status: string }).status !== "active") fail("Only an unfinished workout can be discarded", "discard_validation", "WORKOUT_NOT_ACTIVE");
  const { error } = await client.from("workout_sessions").delete().eq("id", workoutId).eq("user_id", userId).eq("status", "active");
  if (error) fail(error.message, "discard_session", error.code);
  return { discarded: workoutId };
}

export async function importWorkout(client: SupabaseClient, userId: string, workout: Workout, sourceHash: string) {
  if (!isImportableWorkout(workout)) return { status: "skipped", reason: "test_data" };
  const { data: receipt, error: receiptError } = await client.from("workout_import_receipts").select("*").eq("user_id", userId).eq("source_record_id", workout.id).eq("source_hash", sourceHash).maybeSingle();
  if (receiptError) fail(receiptError.message, "import_receipt_lookup", receiptError.code); if (receipt) return { status: "skipped", reason: "already_imported", receipt };
  const created = await createOrResumeWorkout(client, userId, workout);
  const session = created.session as WorkoutSessionRow;
  if (created.resumed && session.status === "completed") return { status: "skipped", reason: "already_completed", session };
  const existing = created.resumed ? await getWorkoutSession(client, userId, session.id) : null;
  if (!created.resumed || shouldPreferIncoming(existing?.sets.length ?? 0, workout.sets.length)) {
    for (const [index, set] of workout.sets.entries()) await upsertWorkoutSet(client, userId, session.id, set, index);
  }
  if (workout.cardio) await upsertWorkoutCardio(client, userId, session.id, workout.cardio);
  const { data: savedReceipt, error } = await client.from("workout_import_receipts").insert({ user_id: userId, source: "local-first", source_record_id: workout.id, source_hash: sourceHash, imported_session_id: session.id, status: "imported", details: { populated: workout.sets.length > 0 } }).select().single();
  if (error && error.code !== "23505") fail(error.message, "import_receipt_write", error.code);
  return { status: "imported", resumed: created.resumed, session, receipt: savedReceipt };
}

/** Owner-reviewed recovery: preserve a test canonical row, then promote a verified real candidate. */
export async function reconcileMondayWorkout(client: SupabaseClient, userId: string, incoming: Workout) {
  if (incoming.origin === "test" || incoming.plannedSessionId !== "mon" || incoming.scheduledDate !== "2026-08-31" || incoming.status !== "completed" || (incoming.sets.length === 0 && !incoming.cardio)) {
    fail("Only a verified completed Monday candidate can be reconciled", "reconcile_validation", "INVALID_RECOVERY_CANDIDATE");
  }
  const { data: existing, error: lookupError } = await client.from("workout_sessions").select("*").eq("user_id", userId).eq("planned_session_id", "mon").eq("scheduled_date", "2026-08-31").maybeSingle();
  if (lookupError) fail(lookupError.message, "reconcile_lookup", lookupError.code);
  if (existing && existing.origin !== "test") {
    const current = await getWorkoutSession(client, userId, existing.id);
    const currentSets = (current?.sets ?? []) as Array<Record<string, unknown>>;
    if (currentSets.filter(set => set.kind === "working").length >= 25 && current?.cardio) return { promoted: existing.id, alreadyRecovered: true };
    for (const [index, set] of incoming.sets.entries()) {
      if (!currentSets[index]) await upsertWorkoutSet(client, userId, existing.id, set, index, true);
    }
    if (incoming.cardio && !current?.cardio) await upsertWorkoutCardio(client, userId, existing.id, incoming.cardio);
    return { promoted: existing.id, alreadyRecovered: false };
  }
  if (existing?.origin === "test") {
    const metadata = { ...((existing.metadata as Record<string, unknown> | null) ?? {}), reconciliation: { reason: "owner-reviewed genuine recovery", deCanonicalizedAt: new Date().toISOString(), formerCanonicalKey: "mon:2026-08-31" } };
    const { error } = await client.from("workout_sessions").update({ planned_session_id: null, scheduled_date: null, metadata, updated_at: new Date().toISOString(), version: Number(existing.version ?? 1) + 1 }).eq("id", existing.id).eq("user_id", userId).eq("origin", "test");
    if (error) fail(error.message, "reconcile_decanonicalize_test", error.code);
  }
  const created = await createOrResumeWorkout(client, userId, incoming);
  const session = created.session as WorkoutSessionRow;
  if (created.resumed && session.origin !== "test" && session.id !== incoming.id) fail("A genuine Monday session already exists; no automatic replacement was performed", "reconcile_conflict", "GENUINE_SESSION_EXISTS");
  for (const [index, set] of incoming.sets.entries()) await upsertWorkoutSet(client, userId, session.id, set, index, true);
  if (incoming.cardio) await upsertWorkoutCardio(client, userId, session.id, incoming.cardio);
  if (session.status !== "completed") await completeWorkout(client, userId, session.id, incoming.completedAt ?? new Date().toISOString(), session.version);
  return { promoted: session.id, preservedTest: existing?.origin === "test" ? existing.id : undefined };
}

export { sessionRow, setRows, cardioRow };

async function assertSessionActive(client: SupabaseClient, userId: string, workoutId: string, allowCompleted = false) {
  const { data, error } = await client.from("workout_sessions").select("status").eq("id", workoutId).eq("user_id", userId).maybeSingle();
  if (error) fail(error.message, "session_state", error.code);
  const session = data as { status: string } | null;
  if (!session) { const missing = new Error("Workout session not found") as RepositoryError; missing.operation = "session_state"; missing.code = "NOT_FOUND"; throw missing; }
  if (session.status !== "active" && !allowCompleted) fail("Completed workout cannot be changed", "session_state", "WORKOUT_COMPLETED");
}
