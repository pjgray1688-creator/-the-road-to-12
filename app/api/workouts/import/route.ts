import { createHash } from "node:crypto";
import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";
import { importWorkout } from "@/lib/workout-repository";
import type { Workout } from "@/lib/types";

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { workouts?: Workout[]; includeTestData?: boolean } | null;
  if (!Array.isArray(body?.workouts)) return privateJson({ error: "Invalid import" }, { status: 400 });
  const results = [];
  for (const workout of body.workouts) {
    if (workout.origin === "test" && !body.includeTestData) { results.push({ id: workout.id, status: "skipped", reason: "test_data" }); continue; }
    const sourceHash = createHash("sha256").update(JSON.stringify(workout)).digest("hex");
    try { results.push({ id: workout.id, ...(await importWorkout(client, user.id, workout, sourceHash)) }); }
    catch { results.push({ id: workout.id, status: "failed", reason: "persistence_failed" }); }
  }
  return privateJson({ results });
}
