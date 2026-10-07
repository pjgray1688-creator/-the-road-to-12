import { CoachWorkspace } from "@/components/coach-workspace";
import { AppNav } from "@/components/app-nav";
import { authenticatedServerClient } from "@/lib/require-user";
import { TutorialExperience } from "@/components/tutorial-experience";

export default async function CoachPage() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return <><main className="shell"><section className="card"><h1>Coach sign-in required</h1><p>Sign in with an authorised Coach account to continue.</p></section></main><AppNav /></>;
  const { data, error } = await client.rpc("coach_list_clients");
  if (error) {
    console.error("[coach] client list failed", { code: error.code });
    const denied = error.code === "42501";
    return <><main className="shell"><section className="card"><h1>{denied ? "Coach access unavailable" : "Coach service unavailable"}</h1><p>{denied ? "Your account is not authorised for Coach yet." : "Coach is temporarily unavailable. Please try again shortly."}</p></section></main><AppNav /></>;
  }
  return <><CoachWorkspace initialClients={(Array.isArray(data) ? data : []) as never} /><TutorialExperience area="coach" /><AppNav /></>;
}
