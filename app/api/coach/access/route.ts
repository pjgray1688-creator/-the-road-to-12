import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function GET() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await client.rpc("coach_has_access", { p_client_user_id: null });
  if (error) return privateJson({ error: "Coach access unavailable" }, { status: 503 });
  return privateJson({ allowed: Boolean(data) });
}
