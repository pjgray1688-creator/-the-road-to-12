import { NextResponse } from "next/server";
import { authenticatedServerClient } from "@/lib/require-user";
import { completeWorkout } from "@/lib/workout-repository";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params; const body = await request.json().catch(() => ({}));
  try { return NextResponse.json({ session: await completeWorkout(client, user.id, id, typeof body.completedAt === "string" ? body.completedAt : new Date().toISOString(), typeof body.expectedVersion === "number" ? body.expectedVersion : undefined) }); }
  catch (error) { const code = (error as { code?: string }).code; return NextResponse.json({ error: code === "WORKOUT_CONFLICT" ? "Workout changed on another device" : "Unable to complete workout", code }, { status: code === "WORKOUT_CONFLICT" ? 409 : 500 }); }
}
