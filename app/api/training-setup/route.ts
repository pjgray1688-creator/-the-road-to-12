import { authenticatedServerClient } from "@/lib/require-user";
import { privateJson } from "@/lib/private-response";

const choices = new Set(["r12", "manual", "coach", "skip"]);

export async function GET() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await client.from("profiles").select("training_profile").eq("id", user.id).maybeSingle();
  if (error) return privateJson({ error: "Training preference unavailable" }, { status: 503 });
  const profile = data?.training_profile && typeof data.training_profile === "object" ? data.training_profile as Record<string, unknown> : {};
  return privateJson({ choice: profile._trainingSetupChoice ?? null });
}

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !choices.has(body.choice)) return privateJson({ error: "Choose a training setup option." }, { status: 400 });
  const { data, error } = await client.from("profiles").select("training_profile").eq("id", user.id).maybeSingle();
  if (error) return privateJson({ error: "Training preference could not be saved" }, { status: 503 });
  const profile = data?.training_profile && typeof data.training_profile === "object" ? data.training_profile as Record<string, unknown> : {};
  const { error: saveError } = await client.from("profiles").update({ training_profile: { ...profile, _trainingSetupChoice: body.choice } }).eq("id", user.id);
  if (saveError) return privateJson({ error: "Training preference could not be saved" }, { status: 503 });
  return privateJson({ choice: body.choice });
}
