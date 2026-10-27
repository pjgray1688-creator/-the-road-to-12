export function GlowZoneNav({ current }: { current: "home" | "use" | "buy" | "account" }) {
  const items = [
    { id: "home", href: "/glow-zone", label: "Home" },
    { id: "use", href: "/glow-zone/use", label: "Use Sunbed" },
    { id: "buy", href: "/glow-zone/buy", label: "Buy Minutes" },
    { id: "account", href: "/account?app=glow&next=%2Fglow-zone", label: "Account" },
  ] as const;
  return <nav className="glow-zone-nav" aria-label="Glow Zone navigation">{items.map(item => <a key={item.id} href={item.href} aria-current={current === item.id ? "page" : undefined}>{item.label}</a>)}</nav>;
}
