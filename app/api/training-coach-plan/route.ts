import { authenticatedServerClient } from "@/lib/require-user";
import { privateJson } from "@/lib/private-response";

export async function GET() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await client.rpc("member_get_my_coach_plan");
  if (error) return privateJson({ error: "Coach programme status is unavailable" }, { status: 503 });
  return privateJson(data ?? { state: "none" });
}
