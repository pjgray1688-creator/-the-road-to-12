import VerifyAccountClient from "@/components/verify-account-client";
import { safeInternalReturnTo } from "@/lib/auth-return";

export default async function VerifyAccountPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  return <VerifyAccountClient next={safeInternalReturnTo(params.next) ?? "/onboarding"} />;
}
