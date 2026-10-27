import { GlowZoneAccountSetup } from "@/components/glow-zone-account-setup";
import { GlowZoneHeader } from "@/components/glow-zone-header";
import { GlowZoneNav } from "@/components/glow-zone-nav";
import { AppShell, Surface } from "@/components/ui";

type GlowDestination = "home" | "use" | "buy";

const titles: Record<GlowDestination, string> = { home: "Welcome to Glow Zone", use: "Use a sunbed", buy: "Buy minutes" };
export function GlowZoneCustomerGate({ current, unavailable = false }: { current: GlowDestination; unavailable?: boolean }) {
  return <AppShell className="module-page glow-zone-page">
    <GlowZoneHeader title={titles[current]} description="Your shared R12 account works here without creating a gym membership." />
    <Surface>{unavailable ? <p className="muted">Glow Zone could not load your customer details. We’ll retry securely without changing memberships, minutes or eligibility.</p> : null}<GlowZoneAccountSetup /></Surface>
    <GlowZoneNav current={current} />
  </AppShell>;
}
