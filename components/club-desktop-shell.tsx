"use client";
/* eslint-disable @next/next/no-img-element -- organisation branding may use tenant-managed image hosts. */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { ClubRole, Organisation } from "@/lib/club";
import styles from "./club-desktop-shell.module.css";

type NavAccess = { members: boolean; payments: boolean; management?: boolean; finance?: boolean; cashControls?: boolean; cashTill?: boolean; balanceTopUp?: boolean; collections?: boolean; classSetup?: boolean; memberships?: boolean; memberImports?: boolean; promotions?: boolean; suppliers?: boolean; supplierOrders?: boolean; staff?: boolean; stationAdmin?: boolean; venues?: boolean; reports?: boolean; services?: boolean; workSubmit?: boolean; workReview?: boolean; dailyChecks?: boolean; glowZone?: boolean; classReports?: boolean; coachDiary?: boolean; induction?: boolean; doorAccess?: boolean };
export type DesktopClubContext = { organisation: Organisation; role: ClubRole; navigation: NavAccess; accent?: string };
export type DesktopClubLocation = { id: string; name: string; active: boolean };
type Props = { contexts: DesktopClubContext[]; locationsByOrganisation: Record<string, DesktopClubLocation[]>; identityControl?: ReactNode; children: ReactNode };

const operationalRoles = new Set<ClubRole>(["owner", "gym_admin", "gym_staff", "trainer"]);
const SIDEBAR_STORAGE_KEY = "r12-club-sidebar-collapsed";
const SIDEBAR_EVENT = "r12-club-sidebar-state";
let sidebarFallback = false;
function readSidebarState() {
  try { return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"; } catch { return sidebarFallback; }
}
function subscribeSidebarState(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SIDEBAR_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(SIDEBAR_EVENT, callback); };
}
function writeSidebarState(value: boolean) {
  sidebarFallback = value;
  try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(value)); } catch { /* Keep the in-session state when storage is unavailable. */ }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}
const roleName: Record<ClubRole, string> = { owner: "Owner", gym_admin: "Gym Admin", gym_staff: "Gym Staff", trainer: "PT / Coach", member: "Member", guest: "Guest" };
type Item = { label: string; href: string; icon: string; match: (path: string) => boolean };
type ItemGroup = { label: string; items: Item[] };

function Icon({ name }: { name: string }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const shapes: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/><rect x="3" y="14" width="8" height="7" rx="1.5"/></>,
    members: <><circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.5a5.5 5.5 0 0 1 11 0V20zM16 5.2a3.2 3.2 0 0 1 0 6.1M17 14a4.7 4.7 0 0 1 4 4.6V20"/></>,
    shop: <><path d="M4 8h16l-1 12H5L4 8Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></>,
    classes: <><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M7 2.5v4M17 2.5v4M3 9h18M8 13h3M8 16h7"/></>,
    operations: <><path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>,
    finance: <><path d="M3 20h18M5 16V9M10 16V4M15 16v-5M20 16V7"/></>,
    management: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z"/></>,
  };
  return <svg {...common}>{shapes[name] ?? shapes.management}</svg>;
}

function activePath(pathname: string, item: Item) { return item.match(pathname); }

export function ClubDesktopShell({ contexts, locationsByOrganisation, identityControl, children }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryOrg = searchParams.get("org") ?? "";
  const selected = contexts.find(item => item.organisation.id === queryOrg) ?? (contexts.length === 1 ? contexts[0] : undefined);
  const operational = Boolean(selected && operationalRoles.has(selected.role));
  const collapsed = useSyncExternalStore(subscribeSidebarState, readSidebarState, () => false);
  const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null);
  const mobileOpen = mobileOpenPath === pathname;
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [managementOverride, setManagementOverride] = useState<{ pathname: string; open: boolean } | null>(null);
  const routeInManagement = pathname.startsWith("/club/more") || pathname.startsWith("/club/members/import") || pathname.startsWith("/club/staff") || pathname.startsWith("/club/memberships") || pathname.startsWith("/club/promotions") || pathname.startsWith("/club/website-shop") || pathname.startsWith("/club/locations") || pathname.startsWith("/club/stations") || pathname.startsWith("/club/reports") || pathname.startsWith("/club/services") || pathname.startsWith("/club/payments") || pathname.startsWith("/club/membership-billing") || pathname.startsWith("/club/classes/setup") || pathname.startsWith("/club/products") || pathname.startsWith("/club/shop/supplier-catalogue") || pathname.startsWith("/club/work/review") || pathname.startsWith("/club/sunbeds") && searchParams.get("view") === "management" || pathname.startsWith("/club/shop") && (searchParams.get("view") === "cash-review" || searchParams.get("till") === "close");
  const managementOpen = managementOverride?.pathname === pathname ? managementOverride.open : routeInManagement;

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = mobileMenuButtonRef.current;
    document.body.style.overflow = "hidden";
    const firstFocusable = mobileMenuRef.current?.querySelector<HTMLElement>('a[href],button:not([disabled])');
    firstFocusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobileOpenPath(null); }
      if (event.key !== "Tab" || !mobileMenuRef.current) return;
      const focusable = [...mobileMenuRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      menuButton?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateOffsets = () => {
      const toolbar = toolbarRef.current;
      const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 0;
      frame.style.setProperty("--club-toolbar-height", `${toolbarHeight}px`);
      frame.style.setProperty("--club-shell-sticky-offset", `${toolbarHeight + 12}px`);
    };
    updateOffsets();
    const observer = new ResizeObserver(updateOffsets);
    const toolbar = toolbarRef.current;
    if (toolbar) observer.observe(toolbar);
    window.addEventListener("resize", updateOffsets);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffsets);
      frame.style.removeProperty("--club-toolbar-height");
      frame.style.removeProperty("--club-shell-sticky-offset");
    };
  }, [pathname]);

  const links = useMemo(() => {
    if (!selected || !operational) return [] as Item[];
    const org = encodeURIComponent(selected.organisation.id);
    const location = searchParams.get("location");
    const q = `?org=${org}${location ? `&location=${encodeURIComponent(location)}` : ""}`;
    const access = selected.navigation;
    return [
      { label: "Overview", href: `/club${q}`, icon: "overview", match: (path: string) => path === "/club" },
      ...(access.members ? [{ label: "Members", href: `/club/members${q}`, icon: "members", match: (path: string) => (path.startsWith("/club/members") && !path.startsWith("/club/members/import")) || path.startsWith("/club/join") }] : []),
      { label: "Classes & PT", href: `/club/classes${q}`, icon: "classes", match: (path: string) => path.startsWith("/club/classes") && !path.startsWith("/club/classes/setup") },
      { label: "Shop & Stock", href: `/club/shop${q}&view=sell`, icon: "shop", match: (path: string) => path.startsWith("/club/shop") && !path.startsWith("/club/shop/supplier-catalogue") && searchParams.get("view") !== "cash-review" && searchParams.get("till") !== "close" },
      ...(access.dailyChecks ? [{ label: "Daily Checks", href: `/club/checks${q}${searchParams.get("location") ? `&location=${encodeURIComponent(searchParams.get("location")!)}` : ""}`, icon: "operations", match: (path: string) => path.startsWith("/club/checks") }] : []),
      { label: "My Rota", href: `/club/schedule${q}&view=mine`, icon: "classes", match: (path: string) => path.startsWith("/club/schedule") },
      ...(access.glowZone ? [{ label: "Glow Zone", href: `/club/sunbeds${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/sunbeds") && searchParams.get("view") !== "management" }] : []),
    ];
  }, [selected, operational, searchParams]);

  if (!operational || !selected) return <div className={styles.inactive}>{children}</div>;

  const access = selected.navigation;
  const orgId = encodeURIComponent(selected.organisation.id);
  const q = `?org=${orgId}${searchParams.get("location") ? `&location=${encodeURIComponent(searchParams.get("location")!)}` : ""}`;
  const managementGroups: ItemGroup[] = [
    { label: "Finance & Payments", items: [
      ...(access.finance ? [{ label: "Finance & sales", href: `/club/payments${q}`, icon: "finance", match: (path: string) => path === "/club/payments" && searchParams.get("view") !== "attempts" }] : []),
      ...(access.finance ? [{ label: "Checkout attempts", href: `/club/payments${q}&view=attempts`, icon: "finance", match: (path: string) => path === "/club/payments" && searchParams.get("view") === "attempts" }] : []),
      ...(access.finance ? [{ label: "Membership billing", href: `/club/membership-billing${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/membership-billing") }] : []),
      ...(access.cashControls ? [{ label: "Till close & verification", href: `/club/shop${q}&view=cash&till=close`, icon: "finance", match: (path: string) => path === "/club/shop" && searchParams.get("till") === "close" }] : []),
      ...(access.cashControls ? [{ label: "Cash approvals", href: `/club/shop${q}&view=cash-review`, icon: "finance", match: (path: string) => path.startsWith("/club/shop") && searchParams.get("view") === "cash-review" }] : []),
      ...(access.cashControls ? [{ label: "Cash collections", href: `/club/payments/cash-collections${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/payments/cash-collections") }] : []),
      ...(access.reports ? [{ label: "Reports & audit", href: `/club/reports${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/reports") }] : []),
    ] },
    { label: "Staff & Rota", items: [
      ...(access.staff ? [{ label: "Staff & permissions", href: `/club/staff${q}`, icon: "members", match: (path: string) => path.startsWith("/club/staff") }] : []),
      ...(access.workReview ? [{ label: "Work submissions", href: `/club/work/review${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/work/review") }] : []),
      ...(access.classSetup ? [{ label: "Rota & daily check setup", href: `/club/classes/setup${q}`, icon: "classes", match: (path: string) => path.startsWith("/club/classes/setup") }] : []),
    ] },
    { label: "Membership Administration", items: [
      ...(access.memberships ? [{ label: "Membership administration", href: `/club/memberships${q}`, icon: "members", match: (path: string) => path.startsWith("/club/memberships") }] : []),
      ...(access.memberImports ? [{ label: "Member imports", href: `/club/members/import${q}`, icon: "members", match: (path: string) => path.startsWith("/club/members/import") }] : []),
    ] },
    { label: "Shop Administration", items: [
      ...(access.promotions ? [{ label: "Promotions & pricing", href: `/club/promotions${q}`, icon: "management", match: (path: string) => path.startsWith("/club/promotions") }] : []),
      ...(access.promotions ? [{ label: "Products & pricing", href: `/club/products${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/products") }] : []),
      ...(access.promotions ? [{ label: "Website Shop", href: `/club/website-shop${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/website-shop") }] : []),
      ...(access.suppliers ? [{ label: "Supplier catalogue", href: `/club/shop/supplier-catalogue${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/shop/supplier-catalogue") }] : []),
      ...(access.services && access.management ? [{ label: "Glow Zone management", href: `/club/sunbeds${q}&view=management`, icon: "operations", match: (path: string) => path.startsWith("/club/sunbeds") && searchParams.get("view") === "management" }] : []),
    ] },
    { label: "Venues & Settings", items: [
      ...(access.venues ? [{ label: "Venues & settings", href: `/club/locations${q}`, icon: "management", match: (path: string) => path.startsWith("/club/locations") }] : []),
      ...(access.stationAdmin ? [{ label: "Shared stations", href: `/club/stations${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/stations") }] : []),
      ...(access.services ? [{ label: "Services & configuration", href: `/club/services${q}`, icon: "management", match: (path: string) => path.startsWith("/club/services") }] : []),
    ] },
  ].filter(group => group.items.length);
  const managementLinks = managementGroups.flatMap(group => group.items);
  const activeManagement = managementLinks.some(item => activePath(pathname, item));
  const venueOptions = (locationsByOrganisation[selected.organisation.id] ?? []).filter(location => location.active);
  const canAggregate = access.venues === true;
  const currentLocation = searchParams.get("location") ?? (canAggregate ? "all" : venueOptions[0]?.id ?? "");
  const logoSrc = selected.organisation.branding?.logoDarkSrc ?? selected.organisation.branding?.logoSrc ?? "/brand/r12-club-emblem.png";
  const accent = selected.accent ?? selected.organisation.branding?.primaryAccent ?? "#9856d8";

  function updateLocation(locationId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", selected!.organisation.id);
    if (locationId && locationId !== "all") params.set("location", locationId); else params.delete("location");
    router.push(`${pathname}?${params.toString()}`);
  }

  function updateOrganisation(organisationId: string) {
    const next = new URLSearchParams();
    next.set("org", organisationId);
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggleCollapsed() {
    writeSidebarState(!collapsed);
  }

  function toggleManagement() {
    if (collapsed) {
      writeSidebarState(false);
      setManagementOverride({ pathname, open: true });
      return;
    }
    setManagementOverride({ pathname, open: !managementOpen });
  }

  const shopRoutes = pathname.startsWith("/club/shop") || pathname.startsWith("/club/products");
  const shopNavigation: Item[] = [
    { label: "Shop", href: `/club/shop${q}&view=sell`, icon: "shop", match: path => path === "/club/shop" && (searchParams.get("view") ?? "sell") === "sell" },
    { label: "Stock", href: `/club/shop${q}&view=stock`, icon: "shop", match: path => path === "/club/shop" && searchParams.get("view") === "stock" },
    ...(access.cashTill ? [{ label: "Cash & till", href: `/club/shop${q}&view=cash&till=log`, icon: "finance", match: (path: string) => path === "/club/shop" && searchParams.get("view") === "cash" }] : []),
    ...(access.balanceTopUp ? [{ label: "Balance top-up", href: `/club/shop/balance${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/shop/balance") }] : []),
    ...(access.supplierOrders ? [{ label: "Supplier orders", href: `/club/shop/supplier-orders${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/shop/supplier-orders") }] : []),
    ...(access.collections ? [{ label: "Collections", href: `/club/shop/collections${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/shop/collections") }] : []),
    { label: "Offers", href: `/club/shop${q}&view=offers`, icon: "management", match: (path: string) => path === "/club/shop" && searchParams.get("view") === "offers" },
  ];
  const classesNavigation: Item[] = [
    { label: "Timetable & bookings", href: `/club/classes${q}`, icon: "classes", match: path => path === "/club/classes" || path.startsWith("/club/classes/") && !path.startsWith("/club/classes/diary") && !path.startsWith("/club/classes/reports") && !path.startsWith("/club/classes/setup") },
    ...(access.coachDiary ? [{ label: "PT diary", href: `/club/classes/diary${q}`, icon: "classes", match: (path: string) => path.startsWith("/club/classes/diary") }] : []),
    ...(access.classReports ? [{ label: "Cancellation & credit reports", href: `/club/classes/reports${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/classes/reports") }] : []),
  ];
  const membersNavigation: Item[] = [
    ...(access.doorAccess ? [{ label: "Door access", href: `/club/access${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/access") }] : []),
  ];
  const dailyNavigation: Item[] = [
    { label: "My shift", href: `/club/work${q}`, icon: "operations", match: path => path === "/club/work" },
    ...(access.induction ? [{ label: "Inductions", href: `/club/induction${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/induction") }] : []),
  ];
  const mobileNavigation = [
    ...links.filter(item => ["Overview", "Members", "Classes & PT", "Shop & Stock", "Daily Checks", "My Rota"].includes(item.label)),
    ...(access.coachDiary ? [{ label: "PT Diary", href: `/club/classes/diary${q}`, icon: "classes", match: (path: string) => path.startsWith("/club/classes/diary") }] : []),
    ...(access.classReports ? [{ label: "Cancellation & credit reports", href: `/club/classes/reports${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/classes/reports") }] : []),
    ...(access.induction ? [{ label: "Inductions", href: `/club/induction${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/induction") }] : []),
  ];
  const isGroupOpen = (name: string, routeActive: boolean) => expandedGroups[name] ?? routeActive;

  function toggleGroup(name: string, routeActive: boolean) {
    if (collapsed) writeSidebarState(false);
    setExpandedGroups(previous => ({ ...previous, [name]: !isGroupOpen(name, routeActive) }));
  }

  const renderSubnav = (items: Item[], onNavigate?: () => void) => <div className={styles.operationalSubNavigation}>{items.map(item => <Link key={item.label} href={item.href} onClick={onNavigate} className={activePath(pathname, item) ? styles.subActive : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}>{item.label}</Link>)}</div>;

  return <div ref={frameRef} className={`${styles.frame} club-desktop-shell-active`} data-collapsed={collapsed ? "true" : "false"} data-mobile-open={mobileOpen ? "true" : "false"} style={{ "--tenant-accent": accent } as CSSProperties}>
    <header className={styles.mobileHeader}>
      <Link className={styles.mobileBrand} href={`/club${q}`} aria-label={`${selected.organisation.name} overview`}><span className={styles.brandLogo}><img src={logoSrc} alt="" /></span><strong>{selected.organisation.branding?.displayName ?? selected.organisation.name}</strong></Link>
      {identityControl ? <div className={styles.mobileIdentity}>{identityControl}</div> : null}
      <button ref={mobileMenuButtonRef} type="button" className={styles.mobileMenuButton} aria-expanded={mobileOpen} aria-controls="club-mobile-navigation" aria-label={mobileOpen ? "Close Club navigation" : "Open Club navigation"} onClick={() => setMobileOpenPath(mobileOpen ? null : pathname)}><span aria-hidden="true">{mobileOpen ? "×" : "☰"}</span></button>
    </header>
    {mobileOpen ? <button type="button" className={styles.mobileBackdrop} aria-label="Close navigation" onClick={() => setMobileOpenPath(null)} /> : null}
    <aside ref={mobileMenuRef} id="club-mobile-navigation" className={styles.sidebar} role={mobileOpen ? "dialog" : undefined} aria-label="Club workspace" aria-modal={mobileOpen ? true : undefined}>
      <Link className={styles.brand} href={`/club${q}`} aria-label={`${selected.organisation.name} overview`}>
        <span className={styles.brandLogo}><img src={logoSrc} alt="" /></span>
        <span className={styles.brandText}><strong>{selected.organisation.branding?.displayName ?? selected.organisation.name}</strong><small>R12 Club</small></span>
      </Link>
      <div className={styles.mobileContextControls}>
        {contexts.length > 1 ? <label className={styles.mobileContextLabel}>Organisation<select aria-label="Choose organisation" value={selected.organisation.id} onChange={event => updateOrganisation(event.target.value)}>{contexts.map(context => <option key={context.organisation.id} value={context.organisation.id}>{context.organisation.name}</option>)}</select></label> : null}
        {venueOptions.length ? <label className={styles.mobileContextLabel}>Venue<select aria-label="Choose current venue" value={currentLocation} onChange={event => updateLocation(event.target.value)}>{canAggregate ? <option value="all">All venues</option> : null}{venueOptions.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}
      </div>
      <nav className={styles.navigation} aria-label="Club workspace navigation">
        <span className={styles.navCaption}>WORKSPACE</span>
        {mobileOpen ? <>
          {mobileNavigation.map(item => {
            if (item.label === "Shop & Stock") {
              const active = activePath(pathname, item) || shopNavigation.some(child => activePath(pathname, child));
              const open = isGroupOpen(item.label, active);
              return <div className={styles.operationalGroup} key={item.label}>
                <div className={styles.groupRow}><Link href={item.href} className={activePath(pathname, item) ? styles.active : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}><Icon name={item.icon} /><span>{item.label}</span></Link><button type="button" aria-label={`${open ? "Collapse" : "Expand"} Shop & Stock links`} aria-expanded={open} onClick={() => toggleGroup(item.label, active)}>⌄</button></div>
                {open ? renderSubnav(shopNavigation, () => setMobileOpenPath(null)) : null}
              </div>;
            }
            return <Link key={item.label} href={item.href} onClick={() => setMobileOpenPath(null)} className={activePath(pathname, item) ? styles.active : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}><Icon name={item.icon} /><span>{item.label}</span></Link>;
          })}
          {access.management ? <div className={styles.managementGroup}>
            <button type="button" className={activeManagement || pathname.startsWith("/club/more") ? styles.active : undefined} aria-expanded={managementOpen} aria-controls="club-mobile-management-links" onClick={toggleManagement} title="Management"><Icon name="management" /><span>Management</span><b aria-hidden="true" className={managementOpen ? styles.chevronOpen : ""}>⌄</b></button>
            {managementOpen ? <div id="club-mobile-management-links" className={styles.subNavigation}>
              <Link href={`/club/more${q}`} onClick={() => setMobileOpenPath(null)} className={pathname.startsWith("/club/more") ? styles.subActive : undefined}>Management home</Link>
              {managementGroups.map(group => <section className={styles.managementSection} key={group.label}><h2>{group.label}</h2>{group.items.map(item => <Link key={item.label} href={item.href} onClick={() => setMobileOpenPath(null)} className={activePath(pathname, item) ? styles.subActive : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}>{item.label}</Link>)}</section>)}
            </div> : null}
          </div> : null}
        </> : links.map(item => {
          const membersGroup = item.label === "Members";
          const classGroup = item.label === "Classes & PT";
          const shopGroup = item.label === "Shop & Stock";
          const dailyGroup = item.label === "Daily Checks";
          if (membersGroup || classGroup || shopGroup || dailyGroup) {
            const name = item.label;
            const children = membersGroup ? membersNavigation : classGroup ? classesNavigation : shopGroup ? shopNavigation : dailyNavigation;
            const active = activePath(pathname, item) || children.some(child => activePath(pathname, child));
            const open = isGroupOpen(name, active);
            return <div className={styles.operationalGroup} key={name}>
              <div className={styles.groupRow}><Link href={item.href} className={active ? styles.active : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={name}><Icon name={item.icon} /><span>{name}</span></Link><button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${name} links`} aria-expanded={open} onClick={() => toggleGroup(name, active)}>⌄</button></div>
              {open ? renderSubnav(children) : null}
            </div>;
          }
          return <Link key={item.label} href={item.href} className={activePath(pathname, item) ? styles.active : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}><Icon name={item.icon} /><span>{item.label}</span></Link>;
        })}
        {!mobileOpen && access.management ? <div className={styles.managementGroup}>
          <button type="button" className={activeManagement || pathname.startsWith("/club/more") ? styles.active : undefined} aria-expanded={managementOpen} aria-controls="club-management-links" onClick={toggleManagement} title="Management"><Icon name="management" /><span>Management</span><b aria-hidden="true" className={managementOpen ? styles.chevronOpen : ""}>⌄</b></button>
          {managementOpen ? <div id="club-management-links" className={styles.subNavigation}>
            {access.management ? <Link href={`/club/more${q}`} onClick={() => setMobileOpenPath(null)} className={pathname.startsWith("/club/more") ? styles.subActive : undefined}>Management home</Link> : null}
            {managementGroups.map(group => <section className={styles.managementSection} key={group.label}><h2>{group.label}</h2>{group.items.map(item => <Link key={item.label} href={item.href} onClick={() => setMobileOpenPath(null)} className={activePath(pathname, item) ? styles.subActive : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}>{item.label}</Link>)}</section>)}
          </div> : null}
        </div> : null}
      </nav>
      <div className={styles.sidebarBottom}><span className={styles.roleBadge} title={roleName[selected.role]}>{roleName[selected.role]}</span><button className={styles.collapseButton} type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><span aria-hidden="true">{collapsed ? "›" : "‹"}</span><span>Collapse sidebar</span></button></div>
    </aside>
    <section className={styles.workspace}>
      <div ref={toolbarRef} className={styles.toolbar}>
        <div className={styles.toolbarControls}>
          {contexts.length > 1 ? <label className={styles.control}><span className="sr-only">Organisation</span><select aria-label="Choose organisation" value={selected.organisation.id} onChange={event => updateOrganisation(event.target.value)}>{contexts.map(context => <option key={context.organisation.id} value={context.organisation.id}>{context.organisation.name}</option>)}</select></label> : null}
          {venueOptions.length ? <label className={styles.control}><span>Venue</span><select aria-label="Choose current venue" value={currentLocation} onChange={event => updateLocation(event.target.value)}>{canAggregate ? <option value="all">All venues</option> : null}{venueOptions.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}
          {access.members && !pathname.startsWith("/club/members") ? <div className={styles.searchControl}><label htmlFor="club-global-search">Search members</label><form key={`${pathname}:${searchParams.get("q") ?? ""}`} className={styles.search} action="/club/members"><input type="hidden" name="org" value={selected.organisation.id} />{searchParams.get("location") ? <input type="hidden" name="location" value={searchParams.get("location")!} /> : null}<input id="club-global-search" type="search" name="q" aria-label="Search members" placeholder="Name or email…" defaultValue={searchParams.get("q") ?? ""} /></form></div> : null}
          {identityControl ? <div className={styles.account}>{identityControl}</div> : null}
        </div>
      </div>
      <div className={`${styles.content}${shopRoutes && pathname === "/club/shop" && (searchParams.get("view") ?? "sell") === "sell" ? ` ${styles.shopSellContent}` : ""}`}>{children}</div>
    </section>
  </div>;
}
