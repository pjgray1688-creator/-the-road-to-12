import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function POST() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await client.rpc("coach_claim_relationships");
  if (error) return privateJson({ error: error.code === "42501" ? "This account cannot accept that coaching connection." : "The coaching connection could not be accepted." }, { status: error.code === "42501" ? 403 : 400 });
  return privateJson(data ?? { claimed: 0 });
}
