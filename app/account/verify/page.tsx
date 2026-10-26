import VerifyAccountClient from "@/components/verify-account-client";
import { authDestination } from "@/lib/auth-return";

export default async function VerifyAccountPage({ searchParams }: { searchParams: Promise<{ app?: string; privacyApp?: string; next?: string }> }) {
  const params = await searchParams;
  const context = authDestination(params, true);
  return <VerifyAccountClient app={context.app} next={context.next} />;
}
