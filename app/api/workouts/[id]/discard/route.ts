import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";
import { discardActiveWorkout } from "@/lib/workout-repository";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  try { return privateJson(await discardActiveWorkout(client, user.id, id)); }
  catch (error) { const code = (error as { code?: string }).code ?? "DISCARD_FAILED"; if (code === "NOT_FOUND") return privateJson({ discarded: id, alreadyAbsent: true }); return privateJson({ error: "Unable to discard workout", code }, { status: code === "WORKOUT_NOT_ACTIVE" ? 409 : 500 }); }
}
