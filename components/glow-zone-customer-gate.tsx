import { GlowZoneAccountSetup } from "@/components/glow-zone-account-setup";
import { GlowZoneHeader } from "@/components/glow-zone-header";
import { GlowZoneNav } from "@/components/glow-zone-nav";
import { AppShell, Surface } from "@/components/ui";

type GlowDestination = "home" | "use" | "buy";

const titles: Record<GlowDestination, string> = { home: "Welcome to Glow Zone", use: "Use a sunbed", buy: "Buy minutes" };
const paths: Record<GlowDestination, string> = { home: "/glow-zone", use: "/glow-zone/use", buy: "/glow-zone/buy" };

export function GlowZoneCustomerGate({ current, unavailable = false }: { current: GlowDestination; unavailable?: boolean }) {
  return <AppShell className="module-page glow-zone-page">
    <GlowZoneHeader title={titles[current]} description="Your shared R12 account works here without creating a gym membership." />
    <Surface>{unavailable ? <><h2>Glow Zone is temporarily unavailable</h2><p className="muted">We couldn’t load your Glow Zone account just now. Please try again or contact reception before purchasing or using minutes.</p></> : <GlowZoneAccountSetup continueTo={paths[current]} />}</Surface>
    <GlowZoneNav current={current} />
  </AppShell>;
}
