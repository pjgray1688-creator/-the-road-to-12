import { redirect } from "next/navigation";
import { GlowZoneCustomerGate } from "@/components/glow-zone-customer-gate";
import { GlowZoneCustomerView } from "@/components/glow-zone-customer-view";
import { GlowZoneReviewerHome } from "@/components/glow-zone-reviewer-home";
import { resolveGlowZoneCustomerContext } from "@/lib/glow-zone-customer-context";
import { isGlowZoneReviewer } from "@/lib/glow-zone-reviewer";
import { serverSupabase } from "@/lib/supabase-server";

export default async function GlowZoneStandalonePage() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=glow&mode=signIn&next=%2Fglow-zone");
  if (isGlowZoneReviewer(user)) return <GlowZoneReviewerHome />;
  const context = await resolveGlowZoneCustomerContext(client, user.id);
  if (context.state === "ready") return <GlowZoneCustomerView organisationId={context.organisation.id} userId={user.id} activeGymMembership={context.activeGymMembership} details={context.details} missingDetails={context.missingDetails} declaredUnder18={context.declaredUnder18} />;
  return <GlowZoneCustomerGate current="home" unavailable={context.state === "unavailable"} />;
}
