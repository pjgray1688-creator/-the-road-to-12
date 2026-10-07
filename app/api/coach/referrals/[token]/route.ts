import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Sign in or create your own R12 account before accepting this invitation." }, { status: 401 });
  const { token } = await context.params;
  const { data, error } = await client.rpc("coach_claim_referral", { p_token: token });
  if (error) return privateJson({ error: error.code === "42501" ? error.message : "This coaching invitation could not be accepted." }, { status: error.code === "42501" ? 403 : 400 });
  return privateJson(data ?? { status: "active" });
}
