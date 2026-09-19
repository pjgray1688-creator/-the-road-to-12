import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";
import { upsertWorkoutCardio } from "@/lib/workout-repository";
import type { Cardio } from "@/lib/types";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params; const cardio = await request.json().catch(() => null) as Cardio | null;
  if (!cardio || typeof cardio.duration !== "number") return privateJson({ error: "Invalid cardio" }, { status: 400 });
  try { return privateJson({ cardio: await upsertWorkoutCardio(client, user.id, id, cardio) }); }
  catch { return privateJson({ error: "Unable to save cardio" }, { status: 500 }); }
}
