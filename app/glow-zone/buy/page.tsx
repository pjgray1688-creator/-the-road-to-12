import { isGlowZoneReviewer } from "@/lib/glow-zone-reviewer";
import { redirect } from "next/navigation";
import { AppShell,PageHeader,Surface } from "@/components/ui";
import { GlowZoneNav } from "@/components/glow-zone-nav";
import { glowZonePackages } from "@/lib/glow-zone";
import { resolveGlowZoneCustomerContext } from "@/lib/glow-zone-customer-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function GlowZoneBuyPage(){
 const client=await serverSupabase();const{data:{user}}=await client.auth.getUser();if(!user)redirect("/account?privacyApp=glow&mode=signIn&next=%2Fglow-zone%2Fbuy");
 if(isGlowZoneReviewer(user))return (
      <AppShell className="module-page glow-zone-page">
        <div className="glow-zone-atmosphere" aria-hidden="true"/>
        <PageHeader eyebrow="GLOW ZONE · CARLTON"
          title="Buy Minutes"/>
        <Surface>
          <span className="eyebrow glow-pink">
            MINUTE PACKAGES · DEMO
          </span>
          {glowZonePackages.filter(item => !item.membersOnly).map(item=>(
            <div className="glow-package-row" key={item.id}>
              <span>
                <strong>{item.name}</strong>
                <small>{item.minutes} minutes</small>

              </span>
              <strong className="glow-price">
                £{(item.priceMinor/100).toFixed(2)}
              </strong>
            </div>
          ))}
          <div className="glow-package-row">
            <span><strong>Pay as you go</strong><small>£1 per minute</small></span>
            <strong className="glow-price">£1/min</strong>
          </div>
        </Surface>
        <Surface>
          <h2>Payment options</h2><button className="glow-checkout-soon" disabled>Pay by card · Coming soon</button>
          <p className="muted">
            This is an App Store demonstration.
            No payment will be taken.
          </p>
        </Surface>
        <GlowZoneNav current="buy"/>
      </AppShell>
    );
const context=await resolveGlowZoneCustomerContext(client,user.id);if(context.state!=="ready")redirect("/glow-zone");
 const packages=glowZonePackages.filter(item=>item.membersOnly===context.activeGymMembership);
 return <AppShell className="module-page glow-zone-page"><div className="glow-zone-atmosphere" aria-hidden="true"/><PageHeader eyebrow="GLOW ZONE · CARLTON" title="Buy Minutes"/><Surface><span className="eyebrow glow-pink">MINUTE PACKAGES</span>{packages.map(item=><div className="glow-package-row" key={item.id}><span><strong>{item.name}</strong><small>{item.minutes} minutes</small></span><strong className="glow-price">£{(item.priceMinor/100).toFixed(2)}</strong></div>)}<div className="glow-package-row"><span><strong>Pay as you go</strong><small>£1 per minute</small></span><strong className="glow-price">£1/min</strong></div></Surface><Surface><h2>Payment options</h2><button className="glow-checkout-soon" disabled>Pay by card · Coming soon</button><p className="muted">Cash and card-terminal top-ups remain available at Carlton reception. Minutes are added only after staff confirm payment.</p><p className="muted">Online card checkout is not yet available for Glow Zone. Online checkout will be available shortly.</p></Surface><GlowZoneNav current="buy"/></AppShell>;
}
