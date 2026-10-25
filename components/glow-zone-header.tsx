import Image from "next/image";

export function GlowZoneHeader({ title, description, demo = false }: { title: string; description?: string; demo?: boolean }) {
  return <header className="glow-zone-header">
    <div className="glow-zone-brand-row">
      <Image src="/r12-app-assets/glow-zone-brand.png" width="58" height="58" alt="Glow Zone" priority />
      {demo ? <span className="glow-demo-badge">Demo</span> : null}
    </div>
    <h1>{title}</h1>
    {description ? <p>{description}</p> : null}
  </header>;
}
