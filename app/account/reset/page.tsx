import { ResetPasswordClient } from "@/components/reset-password-client";
import { authDestination } from "@/lib/auth-return";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  const context = authDestination(await searchParams);
  return <ResetPasswordClient app={context.app} />;
}
