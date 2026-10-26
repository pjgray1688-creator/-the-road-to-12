import { ResetPasswordClient } from "@/components/reset-password-client";
import { authDestination } from "@/lib/auth-return";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ app?: string; next?: string }> }) {
  const context = authDestination(await searchParams);
  return <ResetPasswordClient app={context.app} next={context.next} />;
}
