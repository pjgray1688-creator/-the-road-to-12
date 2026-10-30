"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { ClubRole, Organisation } from "@/lib/club";
import styles from "./club-shell.module.css";

type NavigationAccess = { members: boolean; payments: boolean };
type ClubContextOption = { organisation: Organisation; role: ClubRole; navigation?: NavigationAccess };
type NavigationGroup = "Overview" | "Members" | "Payments" | "Shop" | "Classes & PT" | "Operations" | "Management";
type NavigationLink = { label: string; href: string; group: NavigationGroup };

const labelRole = (role: ClubRole) => ({ gym_staff: "Staff", gym_admin: "Admin", owner: "Owner", trainer: "Trainer", member: "Member", guest: "Guest" }[role] ?? role);

function groupForPath(pathname: string): NavigationGroup {
  const path = pathname.startsWith("/club/reviewer") ? `/club${pathname.slice("/club/reviewer".length)}` : pathname;
  if (path === "/club") return "Overview";
  if (path.startsWith("/club/members") || path.startsWith("/club/join")) return "Members";
  if (path.startsWith("/club/payments") || path.startsWith("/club/reports") || path.startsWith("/club/membership-billing")) return "Payments";
  if (path.startsWith("/club/shop") || path.startsWith("/club/products") || path.startsWith("/club/promotions")) return "Shop";
  if (path.startsWith("/club/classes") || path.startsWith("/club/schedule") || path.startsWith("/club/work")) return "Classes & PT";
  if (["/club/check-in", "/club/access", "/club/reception", "/club/induction", "/club/checks", "/club/sunbeds"].some(route => path.startsWith(route))) return "Operations";
  return "Management";
}

export function ClubSectionNav({ organisation, role, contexts = [], locations = [], locationId, roleLabelOverride }: { organisation: Organisation; role: ClubRole; contexts?: ClubContextOption[]; locations?: Array<{ id: string; name: string; active: boolean }>; locationId?: string; branding?: boolean; roleLabelOverride?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const query = (nextLocationId = locationId) => `?org=${encodeURIComponent(organisation.id)}${nextLocationId ? `&location=${encodeURIComponent(nextLocationId)}` : ""}`;
  const operational = ["trainer", "gym_staff", "gym_admin", "owner"].includes(role);
  const admin = ["gym_admin", "owner"].includes(role);
  const navigation = contexts.find(context => context.organisation.id === organisation.id)?.navigation;
  const membersAllowed = navigation?.members ?? operational;
  const paymentsAllowed = navigation?.payments ?? admin;
  const activeVenues = locations.filter(location => location.active);
  const canAggregate = admin;

  const primaryLinks: NavigationLink[] = operational ? [
    { label: "Overview", href: `/club${query()}`, group: "Overview" },
    ...(membersAllowed ? [{ label: "Members", href: `/club/members${query()}`, group: "Members" as const }] : []),
    ...(paymentsAllowed ? [{ label: "Payments", href: `/club/payments${query()}`, group: "Payments" as const }] : []),
    { label: "Shop", href: `/club/shop${query()}&view=sell`, group: "Shop" },
    { label: "Classes & PT", href: `/club/classes${query()}`, group: "Classes & PT" },
    { label: "Operations", href: `/club/check-in${query()}`, group: "Operations" },
    ...(admin ? [{ label: "Management", href: `/club/more${query()}`, group: "Management" as const }] : []),
  ] : [
    { label: "Classes", href: `/club/classes${query()}`, group: "Classes & PT" },
    { label: "Shop", href: `/club/shop${query()}`, group: "Shop" },
    { label: "Membership payments", href: `/club/membership-billing${query()}`, group: "Payments" },
  ];

  const activeGroup = groupForPath(pathname);
  const secondaryByGroup: Partial<Record<NavigationGroup, NavigationLink[]>> = operational ? {
    Members: membersAllowed ? [
      { label: "Member directory", href: `/club/members${query()}`, group: "Members" },
      ...(admin ? [{ label: "Member imports", href: `/club/members/import${query()}`, group: "Members" as const }] : []),
    ] : [],
    Payments: paymentsAllowed ? [
      { label: "Finance overview", href: `/club/payments${query()}`, group: "Payments" },
      { label: "Transactions", href: `/club/payments${query()}#transactions`, group: "Payments" },
      { label: "Membership payments", href: `/club/membership-billing${query()}`, group: "Payments" },
      { label: "Failed & overdue", href: `/club/payments${query()}#attention`, group: "Payments" },
      { label: "Cash verification", href: `/club/payments${query()}#cash`, group: "Payments" },
      { label: "Reports", href: `/club/reports${query()}`, group: "Payments" },
    ] : [],
    "Classes & PT": [
      { label: "Classes", href: `/club/classes${query()}`, group: "Classes & PT" },
      { label: "Schedule", href: `/club/schedule${query()}`, group: "Classes & PT" },
      { label: "My work", href: `/club/work${query()}`, group: "Classes & PT" },
    ],
    Operations: [
      { label: "Check-in", href: `/club/check-in${query()}`, group: "Operations" },
      { label: "Door access", href: `/club/access${query()}`, group: "Operations" },
      { label: "Inductions", href: `/club/induction${query()}`, group: "Operations" },
      { label: "Daily checks", href: `/club/checks${query()}`, group: "Operations" },
      { label: "Glow Zone", href: `/club/sunbeds${query()}`, group: "Operations" },
    ],
    Management: admin ? [
      { label: "Management home", href: `/club/more${query()}`, group: "Management" },
      { label: "Staff & permissions", href: `/club/staff${query()}`, group: "Management" },
      { label: "Venues", href: `/club/locations${query()}`, group: "Management" },
      { label: "Shared stations", href: `/club/stations${query()}`, group: "Management" },
      { label: "Services", href: `/club/services${query()}`, group: "Management" },
    ] : [],
  } : {};
  const secondaryLinks = secondaryByGroup[activeGroup] ?? [];
  const renderPrimary = (mobile = false) => primaryLinks.map(link => <Link href={link.href} key={link.group} aria-current={link.group === activeGroup ? "page" : undefined} className={link.group === activeGroup ? styles.active : undefined} onClick={() => mobile && setMobileOpen(false)}>{link.label}</Link>);
  const renderSecondary = (mobile = false) => secondaryLinks.map(link => <Link href={link.href} key={`${link.label}-${link.href}`} onClick={() => mobile && setMobileOpen(false)}>{link.label}</Link>);

  return <nav className={styles.nav} aria-label="Club navigation">
    <div className={styles.identity}>
      <div className={styles.tenant}><span aria-hidden="true" className={styles.tenantMark} /><span aria-hidden="true" className={styles.multiply}>×</span><div><span className="eyebrow">CLUB OPERATIONS</span><strong>{organisation.name}</strong></div></div>
      <span className={styles.role}>{roleLabelOverride ?? labelRole(role)}</span>
      <button type="button" className={styles.menuButton} aria-expanded={mobileOpen} aria-controls="club-mobile-menu" onClick={() => setMobileOpen(open => !open)}>{mobileOpen ? "Close" : "Menu"}</button>
    </div>
    <div className={styles.contextControls}>{contexts.length > 1 ? <label className={styles.switcher}>Organisation<select aria-label="Choose organisation" defaultValue={organisation.id} onChange={event => router.push(`/club?org=${encodeURIComponent(event.target.value)}`)}>{contexts.map(context => <option key={context.organisation.id} value={context.organisation.id}>{context.organisation.name}</option>)}</select></label> : null}{activeVenues.length ? <label className={styles.switcher}>Venue<select aria-label="Choose operational venue" value={locationId ?? (canAggregate ? "all" : activeVenues[0]?.id)} onChange={event => router.push(`${pathname}${query(event.target.value === "all" ? undefined : event.target.value)}`)}>{canAggregate ? <option value="all">All locations</option> : null}{activeVenues.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}</div>
    <div className={styles.primaryNavigation}>{renderPrimary()}</div>
    {secondaryLinks.length ? <div className={styles.secondaryNavigation} aria-label={`${activeGroup} navigation`}>{renderSecondary()}</div> : null}
    {mobileOpen ? <div id="club-mobile-menu" className={styles.mobileMenu}><strong>Club sections</strong>{renderPrimary(true)}{secondaryLinks.length ? <><strong>{activeGroup}</strong>{renderSecondary(true)}</> : null}</div> : null}
  </nav>;
}
