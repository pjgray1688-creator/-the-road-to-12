import Link from "next/link";
import type { ReactNode } from "react";
import { AvailabilitySettings } from "@/components/availability-settings";

export function AppShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`app-shell ${className}`.trim()}>{children}</main>;
}

export function PageHeader({ eyebrow = "THE ROAD TO 12%", title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-header-description">{description}</p>}</div>{children}{title === "Training" && <AvailabilitySettings />}</header>;
}

export function BackButton({ href = "/", children = "Back" }: { href?: string; children?: ReactNode }) {
  return <Link className="back-button" href={href}><span aria-hidden="true">‹</span>{children}</Link>;
}

export function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title?: string; action?: ReactNode }) {
  return <div className="section-header">{eyebrow && <span className="eyebrow">{eyebrow}</span>}{title && <h2>{title}</h2>}{action}</div>;
}

export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`surface ${className}`.trim()}>{children}</section>;
}

export function NavigationRow({ href, label, detail, children, onClick }: { href?: string; label: string; detail?: string; children?: ReactNode; onClick?: () => void }) {
  const content = <><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>{children ?? <b aria-hidden="true">›</b>}</>;
  return href ? <Link className="navigation-row" href={href}>{content}</Link> : <button className="navigation-row" type="button" onClick={onClick}>{content}</button>;
}

export function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="metric-card"><span className="eyebrow">{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(bounded)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><span style={{ width: `${bounded}%` }} /></div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
