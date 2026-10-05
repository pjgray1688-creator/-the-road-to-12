import { CoachWorkspace } from "@/components/coach-workspace";
import { AppNav } from "@/components/app-nav";
import { authenticatedServerClient } from "@/lib/require-user";

export default async function CoachPage() {
  const { client, user } = await authenticatedServerClient();
  if (!user) return <><main className="shell"><section className="card"><h1>Coach sign-in required</h1><p>Sign in with an authorised Coach account to continue.</p></section></main><AppNav /></>;
  const { data, error } = await client.rpc("coach_list_clients");
  if (error) return <><main className="shell"><section className="card"><h1>Coach access unavailable</h1><p>Your account does not have explicit Coach permission for this workspace.</p></section></main><AppNav /></>;
  return <><CoachWorkspace initialClients={(Array.isArray(data) ? data : []) as never} /><AppNav /></>;
}
