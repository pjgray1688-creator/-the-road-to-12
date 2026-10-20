import { AuthenticatedHome } from "@/components/authenticated-home";
import { HomeShell } from "@/components/home-shell";
import { authenticatedServerClient } from "@/lib/require-user";

export default async function Home() {
  const { user } = await authenticatedServerClient();
  if (!user) return <AuthenticatedHome />;
  return <HomeShell key={user.id} userId={user.id} />;
}
