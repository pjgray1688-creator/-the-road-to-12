import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

function assignmentContext(request: Request) {
  const url = new URL(request.url);
  return { organisationId: url.searchParams.get("organisationId"), assignmentId: url.searchParams.get("assignmentId"), relationshipId: url.searchParams.get("relationshipId") };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const { organisationId, assignmentId } = assignmentContext(request);
  if (!assignmentId) return privateJson({ error: "Coach client context required" }, { status: 400 });
  const { data, error } = await client.rpc("coach_get_client", { p_client_user_id: id, p_organisation_id: organisationId, p_assignment_id: assignmentId });
  if (error) {
    console.error("[coach] client detail failed", { code: error.code });
    return privateJson({ error: error.code === "42501" ? "You are not authorised to view this client." : "Coach service is temporarily unavailable." }, { status: error.code === "42501" ? 403 : 503 });
  }
  return privateJson({ client: data });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const organisationId = typeof body.organisationId === "string" && body.organisationId ? body.organisationId : null;
  const assignmentId = typeof body.assignmentId === "string" ? body.assignmentId : "";
  const relationshipId = typeof body.relationshipId === "string" ? body.relationshipId : null;
  if (!assignmentId) return privateJson({ error: "Coach client context required" }, { status: 400 });
  const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey : crypto.randomUUID();
  const programmeSessionId = typeof body.programmeSessionId === "string" ? body.programmeSessionId : null;
  const { data, error } = await client.rpc("coach_start_session", { p_client_user_id: id, p_organisation_id: organisationId, p_assignment_id: assignmentId, p_relationship_id: relationshipId, p_idempotency_key: key, p_programme_id: programmeSessionId });
  if (error) return privateJson({ error: "Session could not be started" }, { status: error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400 });
  return privateJson({ session: data }, { status: 201 });
}
