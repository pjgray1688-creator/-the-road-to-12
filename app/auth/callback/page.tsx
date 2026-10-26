import { AuthCallbackClient } from "@/components/auth-callback-client";
import { authDestination } from "@/lib/auth-return";

export default async function AuthCallbackPage({ searchParams }: { searchParams: Promise<{ app?: string; next?: string }> }) {
  const context = authDestination(await searchParams, true);
  return <AuthCallbackClient app={context.app} next={context.next} />;
}
