import Link from "next/link";
import { redirect } from "next/navigation";
import { GlowZoneAccountSetup } from "@/components/glow-zone-account-setup";
import { GlowZoneCustomerView } from "@/components/glow-zone-customer-view";
import { GlowZoneHeader } from "@/components/glow-zone-header";
import { GlowZoneNav } from "@/components/glow-zone-nav";
import { GlowZoneReviewerHome } from "@/components/glow-zone-reviewer-home";
import { AppShell, Surface } from "@/components/ui";
import { resolveGlowZoneCustomerContext } from "@/lib/glow-zone-customer-context";
import { isGlowZoneReviewer } from "@/lib/glow-zone-reviewer";
import { serverSupabase } from "@/lib/supabase-server";

export default async function GlowZoneStandalonePage() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=glow&mode=signIn&next=%2Fglow-zone");
  if (isGlowZoneReviewer(user)) return <GlowZoneReviewerHome />;
  const context = await resolveGlowZoneCustomerContext(client, user.id);
  if (context.state === "ready") return <GlowZoneCustomerView organisationId={context.organisation.id} userId={user.id} activeGymMembership={context.activeGymMembership} />;
  return <AppShell className="module-page glow-zone-page">
    <GlowZoneHeader title="Welcome to Glow Zone" description="Use your shared R12 account for Glow Zone without changing your gym membership." />
    <Surface>{context.state === "unavailable" ? <><h2>Glow Zone is temporarily unavailable</h2><p className="muted">The Carlton service could not be resolved. Please contact reception before purchasing or using minutes.</p></> : <GlowZoneAccountSetup />}<Link className="secondary" href="/account?app=glow&next=%2Fglow-zone">Account</Link></Surface>
    <GlowZoneNav current="home" />
  </AppShell>;
}
