import { ResetPasswordClient } from "@/components/reset-password-client";
import { passwordRecoveryDestination } from "@/lib/auth-return";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reset password · R12", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ app?: string; next?: string; redirect_to?: string }> }) {
  const context = passwordRecoveryDestination(await searchParams);
  return <ResetPasswordClient app={context.app} next={context.next} />;
}
