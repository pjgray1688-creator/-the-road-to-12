import { NextResponse } from "next/server";
import { authenticatedServerClient } from "@/lib/require-user";
import { getWorkoutSession, serverSessionToWorkout, updateWorkoutSession } from "@/lib/workout-repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  try { const workout = await getWorkoutSession(client, user.id, id); return workout ? NextResponse.json({ ...workout, workout: serverSessionToWorkout(workout.session as never, workout.sets as Array<Record<string, unknown>>, workout.cardio as Record<string, unknown> | null) }) : NextResponse.json({ error: "Workout not found" }, { status: 404 }); }
  catch { return NextResponse.json({ error: "Unable to load workout" }, { status: 500 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json({ session: await updateWorkoutSession(client, user.id, id, { name: typeof body.name === "string" ? body.name : undefined, metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : undefined, expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined }) });
  } catch (error) { const code = (error as { code?: string }).code; return NextResponse.json({ error: code === "WORKOUT_CONFLICT" ? "Workout changed on another device" : "Unable to update workout", code }, { status: code === "WORKOUT_CONFLICT" ? 409 : 500 }); }
}
