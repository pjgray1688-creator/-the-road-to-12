"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./coach-navigation.module.css";

const destinations = [
  { href: "/coach", label: "Clients", key: "clients" },
  { href: "/coach/diary", label: "Diary", key: "diary" },
  { href: "/coach/programmes", label: "Programmes", key: "programmes" },
  { href: "/coach/nutrition", label: "Nutrition", key: "nutrition" },
  { href: "/coach/account", label: "Account", key: "account" },
];

export function CoachNavigation() {
  const pathname = usePathname();
  const active = pathname === "/coach" || pathname.startsWith("/coach/claim") || pathname.startsWith("/coach/join")
    ? "clients"
    : pathname.startsWith("/coach/diary") ? "diary"
      : pathname.startsWith("/coach/programmes") ? "programmes"
        : pathname.startsWith("/coach/nutrition") ? "nutrition"
          : pathname.startsWith("/coach/account") ? "account" : "";
  return <nav className={styles.nav} aria-label="R12 Coach" data-r12-coach-navigation>
    {destinations.map(item => <Link key={item.key} href={item.href} aria-current={active === item.key ? "page" : undefined} className={active === item.key ? styles.selected : ""}>{item.label}</Link>)}
  </nav>;
}
