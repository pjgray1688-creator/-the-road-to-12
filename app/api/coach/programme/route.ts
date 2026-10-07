import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

function stringOrNull(value: unknown) { return typeof value === "string" && value.trim() ? value : null; }
function context(url: URL) { return { clientUserId: stringOrNull(url.searchParams.get("clientUserId")), organisationId: stringOrNull(url.searchParams.get("organisationId")), assignmentId: stringOrNull(url.searchParams.get("assignmentId")), relationshipId: stringOrNull(url.searchParams.get("relationshipId")) }; }
function rpcError(error: { code?: string } | null, fallback: string) { return privateJson({ error: error?.code === "42501" ? "You are not allowed to change this programme." : fallback }, { status: error?.code === "42501" ? 403 : error?.code === "22023" ? 400 : 503 }); }

export async function GET(request: Request) {
  const { client } = await authenticatedServerClient();
  const values = context(new URL(request.url));
  if (!values.clientUserId) return privateJson({ error: "Client context required" }, { status: 400 });
  const { data, error } = await client.rpc("coach_list_programme_blocks", { p_client_user_id: values.clientUserId, p_organisation_id: values.organisationId, p_assignment_id: values.assignmentId, p_relationship_id: values.relationshipId });
  if (error) return rpcError(error, "Programme history is unavailable.");
  return privateJson(data ?? { blocks: [] });
}

export async function PUT(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || !body.programme || typeof body.programme !== "object") {
    return privateJson({ error: "Programme content is required" }, { status: 400 });
  }
  const clientUserId = stringOrNull(body.clientUserId);
  if (!clientUserId) return privateJson({ error: "Coach client context required" }, { status: 400 });
  if (!stringOrNull(body.blockId)) return privateJson({ error: "A saved programme block is required." }, { status: 400 });
  const { data, error } = await client.rpc("coach_save_programme_block", { p_client_user_id: clientUserId, p_organisation_id: stringOrNull(body.organisationId), p_assignment_id: stringOrNull(body.assignmentId), p_relationship_id: stringOrNull(body.relationshipId), p_block_id: stringOrNull(body.blockId), p_definition: body.programme, p_title: stringOrNull(body.title) ?? body.programme.name ?? "Programme block", p_description: stringOrNull(body.description), p_coach_notes: stringOrNull(body.coachNotes), p_planned_weeks: typeof body.plannedWeeks === "number" ? body.plannedWeeks : null, p_change_note: stringOrNull(body.changeNote) });
  if (error) return rpcError(error, "That programme could not be saved.");
  return privateJson(data ?? {}, { status: 200 });
}

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const clientUserId = stringOrNull(body.clientUserId);
  if (!clientUserId) return privateJson({ error: "Coach client context required" }, { status: 400 });
  const base = { p_client_user_id: clientUserId, p_organisation_id: stringOrNull(body.organisationId), p_assignment_id: stringOrNull(body.assignmentId), p_relationship_id: stringOrNull(body.relationshipId) };
  if (body.action === "create") {
    const { data, error } = await client.rpc("coach_create_programme_block", { ...base, p_title: stringOrNull(body.title) ?? "New block", p_planned_weeks: typeof body.plannedWeeks === "number" ? body.plannedWeeks : null, p_definition: body.definition ?? { id: crypto.randomUUID(), name: stringOrNull(body.title) ?? "New block", week: [] }, p_description: stringOrNull(body.description), p_coach_notes: stringOrNull(body.coachNotes) });
    if (error) return rpcError(error, "Programme block could not be created."); return privateJson(data ?? {});
  }
  if (body.action === "activate") {
    const { data, error } = await client.rpc("coach_activate_programme_block", { ...base, p_block_id: stringOrNull(body.blockId) });
    if (error) return rpcError(error, "Programme block could not be activated."); return privateJson(data ?? {});
  }
  if (body.action === "status") {
    const { data, error } = await client.rpc("coach_set_programme_block_status", { ...base, p_block_id: stringOrNull(body.blockId), p_status: body.status });
    if (error) return rpcError(error, "Programme block could not be updated."); return privateJson(data ?? {});
  }
  if (body.action === "revisions") {
    const { data, error } = await client.rpc("coach_list_programme_revisions", { ...base, p_block_id: stringOrNull(body.blockId) });
    if (error) return rpcError(error, "Revision history is unavailable."); return privateJson({ revisions: data ?? [] });
  }
  return privateJson({ error: "Unsupported programme action" }, { status: 400 });
}
