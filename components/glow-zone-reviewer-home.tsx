import Link from "next/link";
import { AppShell, Surface } from "@/components/ui";
import { GlowZoneHeader } from "@/components/glow-zone-header";
import { GlowZoneNav } from "@/components/glow-zone-nav";

export function GlowZoneReviewerHome() {
  return <AppShell className="module-page glow-zone-page">
    <GlowZoneHeader title="Your minutes" description="Your glow starts here." demo />
    <Surface>
      <span className="eyebrow glow-green">AVAILABLE NOW</span>
      <h2 className="glow-balance"><strong>45</strong><small>minutes</small></h2>
      <div className="glow-home-actions"><Link className="primary" href="/glow-zone/use">Use Sunbed</Link><Link className="secondary" href="/glow-zone/buy">Buy Minutes</Link></div>
    </Surface>
    <Surface>
      <span className="eyebrow">RECENT ACTIVITY</span>
      <div className="glow-package-row"><span><strong>Stand-up session</strong><small>Example session</small></span><strong>−10 min</strong></div>
      <div className="glow-package-row"><span><strong>Minute top-up</strong><small>Example purchase</small></span><strong>+30 min</strong></div>
    </Surface>
    <GlowZoneNav current="home" />
  </AppShell>;
}
