"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Today", icon: "⌂" },
  { href: "/training", label: "Training", icon: "◒" },
  { href: "/progress", label: "Progress", icon: "↗" },
  { href: "/account", label: "Account", icon: "○" },
];

export function AppNav() {
  const pathname = usePathname();
  const [coachAllowed, setCoachAllowed] = useState(false);
  useEffect(() => { if (!pathname.startsWith("/club")) void fetch("/api/coach/access").then(response => response.ok ? response.json() : null).then(result => setCoachAllowed(Boolean(result?.allowed))).catch(() => setCoachAllowed(false)); }, [pathname]);
  if (pathname.startsWith("/club")) return null;
  const visibleItems = coachAllowed ? [...items.slice(0, 2), { href: "/coach", label: "Coach", icon: "✦" }, ...items.slice(2)] : items;
  return <nav className={coachAllowed ? "app-nav has-coach" : "app-nav"} aria-label="Primary navigation">{visibleItems.map(item => <Link className={pathname === item.href ? "selected" : ""} href={item.href} key={item.href} aria-current={pathname === item.href ? "page" : undefined}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></Link>)}</nav>;
}
