import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email : "";
  const relationshipType = body.relationshipType === "cover" ? "cover" : body.relationshipType === "primary" ? "primary" : "";
  if (!email || !relationshipType) return privateJson({ error: "Enter a client email and relationship" }, { status: 400 });
  const { data, error } = await client.rpc("coach_request_relationship", {
    p_client_email: email,
    p_relationship_type: relationshipType,
    p_organisation_id: typeof body.organisationId === "string" ? body.organisationId : null,
  });
  if (error) {
    console.error("[coach] relationship request failed", { code: error.code });
    return privateJson({ error: error.code === "42501" ? "Coach access is not available for this account." : "That client could not be connected." }, { status: error.code === "42501" ? 403 : 400 });
  }
  return privateJson(data ?? { status: "pending" }, { status: 201 });
}

export async function GET() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await client.rpc("coach_list_clients");
  if (error) return privateJson({ error: "Coach clients unavailable" }, { status: error.code === "42501" ? 403 : 503 });
  return privateJson({ clients: Array.isArray(data) ? data : [] });
}
