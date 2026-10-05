import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function GET() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await client.rpc("coach_list_clients");
  if (error) return privateJson({ error: "Coach clients unavailable" }, { status: error.code === "42501" ? 403 : 503 });
  return privateJson({ clients: Array.isArray(data) ? data : [] });
}
