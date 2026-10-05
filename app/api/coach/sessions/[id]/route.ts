import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const exerciseLogs = Array.isArray(body.exerciseLogs) ? body.exerciseLogs.slice(0, 100) : [];
  const { data, error } = await client.rpc("coach_update_session", { p_session_id: id, p_notes: typeof body.notes === "string" ? body.notes : "", p_adaptations: typeof body.adaptations === "string" ? body.adaptations : "", p_substitutions: Array.isArray(body.substitutions) ? body.substitutions : [], p_complete: body.complete === true, p_exercise_logs: exerciseLogs });
  if (error) return privateJson({ error: "Session could not be saved" }, { status: error.code === "42501" ? 403 : 400 });
  return privateJson({ session: data });
}
