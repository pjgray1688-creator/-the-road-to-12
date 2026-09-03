"use client";
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
  if (pathname.startsWith("/club")) return null;
  return <nav className="app-nav" aria-label="Primary navigation">{items.map(item => <Link className={pathname === item.href ? "selected" : ""} href={item.href} key={item.href} aria-current={pathname === item.href ? "page" : undefined}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></Link>)}</nav>;
}
