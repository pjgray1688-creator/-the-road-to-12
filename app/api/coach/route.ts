import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";
import { evaluateSet } from "@/lib/coach";

export async function POST(request: Request) {
  const { user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  // This is the server boundary where a secure AI coach can later augment the local engine.
  const body = await request.json();
  return privateJson(evaluateSet(body.exercise, body.loggedSets, body.feedback, body.previousSets));
}
