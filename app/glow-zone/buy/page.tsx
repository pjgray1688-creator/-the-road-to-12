import { redirect } from "next/navigation";
import { AppShell } from "@/components/ui";
import { GlowZoneBasket } from "@/components/glow-zone-basket";
import { GlowZoneHeader } from "@/components/glow-zone-header";
import { GlowZoneNav } from "@/components/glow-zone-nav";
import { glowZonePackages } from "@/lib/glow-zone";
import { resolveGlowZoneCustomerContext } from "@/lib/glow-zone-customer-context";
import { isGlowZoneReviewer } from "@/lib/glow-zone-reviewer";
import { serverSupabase } from "@/lib/supabase-server";

export default async function GlowZoneBuyPage() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=glow&mode=signIn&next=%2Fglow-zone%2Fbuy");
  const reviewer = isGlowZoneReviewer(user);
  let memberPricing = false;
  if (!reviewer) {
    const context = await resolveGlowZoneCustomerContext(client, user.id);
    if (context.state !== "ready") redirect("/glow-zone");
    memberPricing = context.activeGymMembership;
  }
  const packages = glowZonePackages.filter(item => item.membersOnly === memberPricing);
  return <AppShell className="module-page glow-zone-page">
    <GlowZoneHeader title="Buy minutes" description="Choose a package or pay for only the minutes you need." demo={reviewer} />
    <GlowZoneBasket packages={packages} demo={reviewer} />
    <GlowZoneNav current="buy" />
  </AppShell>;
}
