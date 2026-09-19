import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";
import { deleteWorkout, getWorkoutSession, serverSessionToWorkout, updateWorkoutSession } from "@/lib/workout-repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  try { const workout = await getWorkoutSession(client, user.id, id); return workout ? privateJson({ ...workout, workout: serverSessionToWorkout(workout.session as never, workout.sets as Array<Record<string, unknown>>, workout.cardio as Record<string, unknown> | null) }) : privateJson({ error: "Workout not found" }, { status: 404 }); }
  catch { return privateJson({ error: "Unable to load workout" }, { status: 500 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  try {
    const partial = body.outcome === "partial";
    return privateJson({ session: await updateWorkoutSession(client, user.id, id, { name: typeof body.name === "string" ? body.name : undefined, metadata: body.metadata && typeof body.metadata === "object" ? { ...body.metadata, ...(partial ? { outcome: "partial" } : {}) } : partial ? { outcome: "partial" } : undefined, status: partial ? "completed" : undefined, completedAt: partial && typeof body.completedAt === "string" ? body.completedAt : undefined, expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined }) });
  } catch (error) { const code = (error as { code?: string }).code; return privateJson({ error: code === "WORKOUT_CONFLICT" ? "Workout changed on another device" : "Unable to update workout", code }, { status: code === "WORKOUT_CONFLICT" ? 409 : 500 }); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  try { return privateJson(await deleteWorkout(client, user.id, id)); }
  catch { return privateJson({ error: "Unable to delete workout" }, { status: 500 }); }
}
