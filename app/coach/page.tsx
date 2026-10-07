import { CoachWorkspace } from "@/components/coach-workspace";
import { AppNav } from "@/components/app-nav";
import { authenticatedServerClient } from "@/lib/require-user";
import { TutorialExperience } from "@/components/tutorial-experience";

export default async function CoachPage() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return <><main className="shell"><section className="card"><h1>Coach sign-in required</h1><p>Sign in with an authorised Coach account to continue.</p></section></main><AppNav /></>;
  const [{ data, error }, { data: pending, error: pendingError }, { data: contexts, error: contextError }] = await Promise.all([
    client.rpc("coach_list_clients"),
    client.rpc("coach_list_pending_relationships"),
    client.rpc("coach_list_member_search_contexts"),
  ]);
  if (error || pendingError || contextError) {
    const firstError = error ?? pendingError ?? contextError;
    if (!firstError) throw new Error("Coach workspace failed without an error");
    console.error("[coach] workspace load failed", { code: firstError.code });
    const denied = firstError.code === "42501";
    return <><main className="shell"><section className="card"><h1>{denied ? "Coach access unavailable" : "Coach service unavailable"}</h1><p>{denied ? "Your account is not authorised for Coach yet." : "Coach is temporarily unavailable. Please try again shortly."}</p></section></main><AppNav /></>;
  }
  return <><CoachWorkspace initialClients={(Array.isArray(data) ? data : []) as never} initialPending={(Array.isArray(pending) ? pending : []) as never} memberContexts={(Array.isArray(contexts) ? contexts : []) as never} /><TutorialExperience area="coach" /><AppNav /></>;
}
