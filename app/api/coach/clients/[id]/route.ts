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
  let packageCredits: Array<{ name: string; remaining: number; expiresAt?: string }> = [];
  let packageCreditsUnavailable = false;
  if (organisationId) {
    const { data: creditRows, error: creditError } = await client.rpc("club_list_coach_client_pt_package_balances", { p_organisation_id: organisationId, p_client_user_id: id });
    packageCreditsUnavailable = Boolean(creditError);
    if (!creditError && Array.isArray(creditRows)) {
      const rows = creditRows as Array<Record<string, unknown>>;
      const serviceIds = [...new Set(rows.map(row => String(row.credit_key ?? "").replace("pt_sessions:", "")).filter(value => /^[0-9a-f-]{36}$/i.test(value)))];
      const { data: services } = serviceIds.length ? await client.from("club_services").select("id,name").eq("organisation_id", organisationId).in("id", serviceIds) : { data: [] };
      const names = new Map((Array.isArray(services) ? services : []).map(service => [String(service.id), String(service.name)]));
      packageCredits = rows.map(row => { const id = String(row.credit_key ?? "").replace("pt_sessions:", ""); return { name: names.get(id) ?? "PT package", remaining: Number(row.remaining_quantity ?? 0), ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}) }; });
    }
  }
  return privateJson({ client: { ...(data && typeof data === "object" ? data : {}), packageCredits, packageCreditsUnavailable } });
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
