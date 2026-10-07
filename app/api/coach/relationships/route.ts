import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email : "";
  const relationshipType = body.relationshipType === "cover" ? "cover" : body.relationshipType === "primary" ? "primary" : "";
  if (!relationshipType) return privateJson({ error: "Choose a relationship" }, { status: 400 });
  const mode = body.mode === "madhouse" ? "madhouse" : "private";
  const rpc = mode === "madhouse" ? "coach_request_member_relationship" : "coach_create_referral_invite";
  const params = mode === "madhouse"
    ? { p_organisation_id: typeof body.organisationId === "string" ? body.organisationId : null, p_client_user_id: typeof body.clientUserId === "string" ? body.clientUserId : null, p_relationship_type: relationshipType }
    : { p_client_email: email || null, p_relationship_type: relationshipType };
  if (mode === "madhouse" && (!params.p_organisation_id || !params.p_client_user_id)) return privateJson({ error: "Choose a Madhouse member" }, { status: 400 });
  const { data, error } = await client.rpc(rpc, params);
  if (error) {
    console.error("[coach] relationship request failed", { code: error.code });
    if (error.code === "42501") return privateJson({ error: error.message.includes("different email") ? error.message : "Coach access is not available for this account." }, { status: 403 });
    if (error.code === "22023" && error.message.includes("own account")) return privateJson({ error: "You can’t add your own R12 account as a client." }, { status: 400 });
    return privateJson({ error: error.message.includes("already") ? error.message : "That client could not be connected." }, { status: error.code === "23505" ? 409 : 400 });
  }
  return privateJson(data ?? { status: "pending" }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const relationshipId = typeof body.relationshipId === "string" ? body.relationshipId : "";
  if (!relationshipId) return privateJson({ error: "Pending connection required" }, { status: 400 });
  const { data, error } = await client.rpc("coach_revoke_pending_relationship", { p_relationship_id: relationshipId });
  if (error) return privateJson({ error: error.code === "42501" ? "You cannot cancel this connection." : "The pending connection could not be cancelled." }, { status: error.code === "42501" ? 403 : 400 });
  return privateJson(data ?? { status: "revoked" });
}

export async function PATCH(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const relationshipId = typeof body.relationshipId === "string" ? body.relationshipId : "";
  if (!relationshipId) return privateJson({ error: "Pending connection required" }, { status: 400 });
  const { data, error } = await client.rpc("coach_resend_referral_invite", { p_relationship_id: relationshipId });
  if (error) return privateJson({ error: error.code === "42501" ? "You cannot resend this invitation." : "The invitation could not be prepared again." }, { status: error.code === "42501" ? 403 : 400 });
  return privateJson(data ?? {});
}

export async function GET() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const [{ data, error }, { data: pending, error: pendingError }] = await Promise.all([
    client.rpc("coach_list_clients"),
    client.rpc("coach_list_pending_relationships"),
  ]);
  if (error || pendingError) return privateJson({ error: (error ?? pendingError)?.code === "42501" ? "Coach clients unavailable" : "Coach service unavailable" }, { status: (error ?? pendingError)?.code === "42501" ? 403 : 503 });
  return privateJson({ clients: Array.isArray(data) ? data : [], pending: Array.isArray(pending) ? pending : [] });
}
