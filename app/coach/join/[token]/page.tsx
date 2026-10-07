import { CoachReferralClaim } from "@/components/coach-referral-claim";

export default async function CoachJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CoachReferralClaim token={token} />;
}
