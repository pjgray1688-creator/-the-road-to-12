import { authenticatedServerClient } from "@/lib/require-user";
import { privateJson } from "@/lib/private-response";
import { createOrResumeWorkout, listCompleteWorkouts } from "@/lib/workout-repository";
import type { Workout } from "@/lib/types";

export async function GET() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  try { const workouts = await listCompleteWorkouts(client, user.id); return privateJson({ sessions: workouts, workouts }); }
  catch (error) { return privateJson({ error: "Unable to load workouts" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const workout = await request.json().catch(() => null) as Workout | null;
  if (!workout?.id || !workout.name || !workout.startedAt) return privateJson({ error: "Invalid workout" }, { status: 400 });
  try { return privateJson(await createOrResumeWorkout(client, user.id, workout), { status: 201 }); }
  catch { return privateJson({ error: "Unable to create workout" }, { status: 500 }); }
}
