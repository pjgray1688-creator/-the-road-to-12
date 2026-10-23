"use client";
import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/training", label: "Training", icon: "◒" },
  { href: "/progress", label: "Progress", icon: "↗" },
  { href: "/account", label: "Account", icon: "○" },
];

export function AppNav({ confirmBeforeNavigate = false }: { confirmBeforeNavigate?: boolean }) {
  const pathname = usePathname();
  const memberHub = pathname.startsWith("/member-hub");
  const [coachAllowed, setCoachAllowed] = useState(false);
  useEffect(() => { if (!pathname.startsWith("/club") && !memberHub) void fetch("/api/coach/access", { credentials: "same-origin" }).then(response => response.ok ? response.json() : null).then(result => setCoachAllowed(Boolean(result?.allowed))).catch(() => setCoachAllowed(false)); }, [memberHub, pathname]);
  if (pathname.startsWith("/club")) return null;
  const memberItems = [
    { href: "/", label: "Home", icon: "⌂" },
    { href: "/training", label: "Training", icon: "◒" },
    { href: "/member-hub/shop", label: "Shop", icon: "▣" },
    { href: "/member-hub/classes", label: "Classes", icon: "▦" },
    { href: "/account", label: "Account", icon: "○" },
  ];
  const visibleItems = memberHub ? memberItems : coachAllowed ? [...items.slice(0, 2), { href: "/coach", label: "Coach", icon: "✦" }, ...items.slice(2)] : items;
  function guardNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!confirmBeforeNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!window.confirm("Leave without saving your programme edits?")) event.preventDefault();
  }
  const selectedFor = (href: string) => memberHub
    ? href === "/" ? pathname === "/" || pathname === "/member-hub" : href === "/training" ? pathname === href : href === "/account" ? pathname === href : href === "/member-hub/shop" ? pathname.startsWith("/member-hub/shop") || pathname.startsWith("/member-hub/orders") : pathname.startsWith(href)
    : pathname === href || (href === "/coach" && pathname.startsWith("/coach/"));
  return <nav data-r12-web-navigation="member" className={`${coachAllowed && !memberHub ? "app-nav has-coach" : "app-nav"}${memberHub ? " member-hub-nav" : ""}`} aria-label={memberHub ? "Member Area navigation" : "Primary navigation"}>{visibleItems.map(item => { const selected = selectedFor(item.href); return <Link className={selected ? "selected" : ""} href={item.href} key={item.href} aria-current={selected ? "page" : undefined} onClick={guardNavigation}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></Link>; })}</nav>;
}
