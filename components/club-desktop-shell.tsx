"use client";
/* eslint-disable @next/next/no-img-element -- organisation branding may use tenant-managed image hosts. */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { ClubRole, Organisation } from "@/lib/club";
import styles from "./club-desktop-shell.module.css";

type NavAccess = { members: boolean; payments: boolean; management?: boolean; finance?: boolean; cashControls?: boolean; cashTill?: boolean; classSetup?: boolean; memberships?: boolean; memberImports?: boolean; promotions?: boolean; suppliers?: boolean; staff?: boolean; venues?: boolean; reports?: boolean; services?: boolean; workReview?: boolean };
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
  const shopNavigationRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryOrg = searchParams.get("org") ?? "";
  const selected = contexts.find(item => item.organisation.id === queryOrg) ?? (contexts.length === 1 ? contexts[0] : undefined);
  const operational = Boolean(selected && operationalRoles.has(selected.role));
  const collapsed = useSyncExternalStore(subscribeSidebarState, readSidebarState, () => false);
  const [managementOverride, setManagementOverride] = useState<{ pathname: string; open: boolean } | null>(null);
  const routeInManagement = pathname.startsWith("/club/more") || pathname.startsWith("/club/members/import") || pathname.startsWith("/club/staff") || pathname.startsWith("/club/memberships") || pathname.startsWith("/club/promotions") || pathname.startsWith("/club/website-shop") || pathname.startsWith("/club/locations") || pathname.startsWith("/club/stations") || pathname.startsWith("/club/reports") || pathname.startsWith("/club/services") || pathname.startsWith("/club/payments") || pathname.startsWith("/club/membership-billing") || pathname.startsWith("/club/classes/setup") || pathname.startsWith("/club/products") || pathname.startsWith("/club/work/review") || pathname.startsWith("/club/sunbeds") && searchParams.get("view") === "management" || pathname.startsWith("/club/shop") && (searchParams.get("view") === "cash-review" || searchParams.get("till") === "close");
  const managementOpen = managementOverride?.pathname === pathname ? managementOverride.open : routeInManagement;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateOffsets = () => {
      const toolbar = toolbarRef.current;
      const shopNavigation = shopNavigationRef.current;
      const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 0;
      const shopNavigationHeight = shopNavigation?.getBoundingClientRect().height ?? 0;
      frame.style.setProperty("--club-toolbar-height", `${toolbarHeight}px`);
      frame.style.setProperty("--club-shell-sticky-offset", `${toolbarHeight + shopNavigationHeight + 12}px`);
    };
    updateOffsets();
    const observer = new ResizeObserver(updateOffsets);
    const toolbar = toolbarRef.current;
    const shopNavigation = shopNavigationRef.current;
    if (toolbar) observer.observe(toolbar);
    if (shopNavigation) observer.observe(shopNavigation);
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
      ...(access.members ? [{ label: "Members", href: `/club/members${q}`, icon: "members", match: (path: string) => path.startsWith("/club/members") || path.startsWith("/club/join") }] : []),
      { label: "Classes & PT", href: `/club/classes${q}`, icon: "classes", match: (path: string) => path.startsWith("/club/classes") || path.startsWith("/club/schedule") },
      { label: "Shop & Stock", href: `/club/shop${q}&view=sell`, icon: "shop", match: (path: string) => path.startsWith("/club/shop") || path.startsWith("/club/products") },
      { label: "Daily Operations", href: `/club/work${q}`, icon: "operations", match: (path: string) => ["/club/work", "/club/checks", "/club/access", "/club/reception", "/club/induction", "/club/sunbeds", "/club/lock"].some(route => path.startsWith(route)) },
    ];
  }, [selected, operational, searchParams]);

  if (!operational || !selected) return <div className={styles.inactive}>{children}</div>;

  const access = selected.navigation;
  const orgId = encodeURIComponent(selected.organisation.id);
  const q = `?org=${orgId}${searchParams.get("location") ? `&location=${encodeURIComponent(searchParams.get("location")!)}` : ""}`;
  const managementLinks: Item[] = [
    ...(access.management ? [{ label: "Management home", href: `/club/more${q}`, icon: "management", match: (path: string) => path.startsWith("/club/more") }] : []),
    ...(access.finance ? [{ label: "Finance & sales", href: `/club/payments${q}`, icon: "finance", match: (path: string) => (path === "/club/payments" && searchParams.get("view") !== "attempts") }] : []),
    ...(access.finance ? [{ label: "Checkout attempts", href: `/club/payments${q}&view=attempts`, icon: "finance", match: (path: string) => path === "/club/payments" && searchParams.get("view") === "attempts" }] : []),
    ...(access.finance ? [{ label: "Membership billing", href: `/club/membership-billing${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/membership-billing") }] : []),
    ...(access.cashControls ? [{ label: "Till close & verification", href: `/club/shop${q}&view=cash&till=close`, icon: "finance", match: (path: string) => path === "/club/shop" && searchParams.get("till") === "close" }] : []),
    ...(access.workReview ? [{ label: "Work submissions", href: `/club/work/review${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/work/review") }] : []),
    ...(access.cashControls ? [{ label: "Cash approvals", href: `/club/shop${q}&view=cash-review`, icon: "finance", match: (path: string) => path.startsWith("/club/shop") && searchParams.get("view") === "cash-review" }] : []),
    ...(access.cashControls ? [{ label: "Cash collections", href: `/club/payments/cash-collections${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/payments/cash-collections") }] : []),
    ...(access.cashTill ? [{ label: "Refunds & till history", href: `/club/shop${q}&view=cash&till=log`, icon: "finance", match: (path: string) => path === "/club/shop" && searchParams.get("view") === "cash" && searchParams.get("till") === "log" }] : []),
    ...(access.suppliers ? [{ label: "Supplier Catalogue", href: `/club/shop/supplier-catalogue${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/shop/supplier-catalogue") }] : []),
    ...(access.classSetup ? [{ label: "Recurring classes, rota & checks", href: `/club/classes/setup${q}`, icon: "classes", match: (path: string) => path.startsWith("/club/classes/setup") }] : []),
    ...(access.memberships ? [{ label: "Membership administration", href: `/club/memberships${q}`, icon: "members", match: (path: string) => path.startsWith("/club/memberships") }] : []),
    ...(access.memberImports ? [{ label: "Member imports", href: `/club/members/import${q}`, icon: "members", match: (path: string) => path.startsWith("/club/members/import") }] : []),
    ...(access.promotions ? [{ label: "Promotions & pricing", href: `/club/promotions${q}`, icon: "management", match: (path: string) => path.startsWith("/club/promotions") }] : []),
    ...(access.promotions ? [{ label: "Products & pricing", href: `/club/products${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/products") }] : []),
    ...(access.promotions ? [{ label: "Website Shop", href: `/club/website-shop${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/website-shop") && !path.startsWith("/club/website-shop/orders") }] : []),
    ...(access.promotions ? [{ label: "Website Shop orders", href: `/club/website-shop/orders${q}`, icon: "shop", match: (path: string) => path.startsWith("/club/website-shop/orders") }] : []),
    ...(access.staff ? [{ label: "Staff & permissions", href: `/club/staff${q}`, icon: "members", match: (path: string) => path.startsWith("/club/staff") }] : []),
    ...(access.venues ? [{ label: "Venues & settings", href: `/club/locations${q}`, icon: "management", match: (path: string) => path.startsWith("/club/locations") }] : []),
    ...(access.venues ? [{ label: "Shared stations", href: `/club/stations${q}`, icon: "operations", match: (path: string) => path.startsWith("/club/stations") }] : []),
    ...(access.reports ? [{ label: "Reports & audit", href: `/club/reports${q}`, icon: "finance", match: (path: string) => path.startsWith("/club/reports") }] : []),
    ...(access.services ? [{ label: "Services & configuration", href: `/club/services${q}`, icon: "management", match: (path: string) => path.startsWith("/club/services") }] : []),
    ...(access.services && access.finance ? [{ label: "Glow Zone management", href: `/club/sunbeds${q}&view=management`, icon: "operations", match: (path: string) => path.startsWith("/club/sunbeds") && searchParams.get("view") === "management" }] : []),
  ];
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
  const shopNavigation = [
    { label: "Shop", href: `/club/shop${q}&view=sell`, current: pathname === "/club/shop" && (searchParams.get("view") ?? "sell") === "sell" },
    { label: "Stock", href: `/club/shop${q}&view=stock`, current: pathname === "/club/shop" && searchParams.get("view") === "stock" },
    ...(access.cashTill ? [{ label: "Cash & till", href: `/club/shop${q}&view=cash&till=log`, current: pathname === "/club/shop" && searchParams.get("view") === "cash" }] : []),
    { label: "Balance top-up", href: `/club/shop/balance${q}`, current: pathname.startsWith("/club/shop/balance") },
    ...(access.suppliers ? [{ label: "Supplier orders", href: `/club/shop/supplier-orders${q}`, current: pathname.startsWith("/club/shop/supplier-orders") }] : []),
    { label: "Collections", href: `/club/shop/collections${q}`, current: pathname.startsWith("/club/shop/collections") },
    { label: "Offers", href: `/club/shop${q}&view=offers`, current: pathname === "/club/shop" && searchParams.get("view") === "offers" },
  ];

  return <div ref={frameRef} className={`${styles.frame} club-desktop-shell-active`} data-collapsed={collapsed ? "true" : "false"} style={{ "--tenant-accent": accent } as CSSProperties}>
    <aside className={styles.sidebar} aria-label="Club workspace">
      <Link className={styles.brand} href={`/club${q}`} aria-label={`${selected.organisation.name} overview`}>
        <span className={styles.brandLogo}><img src={logoSrc} alt="" /></span>
        <span className={styles.brandText}><strong>{selected.organisation.branding?.displayName ?? selected.organisation.name}</strong><small>R12 Club</small></span>
      </Link>
      <nav className={styles.navigation} aria-label="Club workspace navigation">
        <span className={styles.navCaption}>WORKSPACE</span>
        {links.map(item => <Link key={item.label} href={item.href} className={activePath(pathname, item) ? styles.active : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}><Icon name={item.icon} /><span>{item.label}</span></Link>)}
        {access.management ? <div className={styles.managementGroup}>
          <button type="button" className={activeManagement || pathname.startsWith("/club/more") ? styles.active : undefined} aria-expanded={managementOpen} aria-controls="club-management-links" onClick={toggleManagement} title="Management"><Icon name="management" /><span>Management</span><b aria-hidden="true" className={managementOpen ? styles.chevronOpen : ""}>⌄</b></button>
          {managementOpen ? <div id="club-management-links" className={styles.subNavigation}>{managementLinks.map(item => <Link key={item.label} href={item.href} className={activePath(pathname, item) ? styles.subActive : undefined} aria-current={activePath(pathname, item) ? "page" : undefined} title={item.label}><span>{item.label}</span></Link>)}</div> : null}
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
      {shopRoutes ? <nav ref={shopNavigationRef} className={styles.shopNavigation} aria-label="Shop sections">{shopNavigation.map(item => <Link key={item.href} href={item.href} aria-current={item.current ? "page" : undefined} className={item.current ? styles.shopActive : undefined}>{item.label}</Link>)}</nav> : null}
      <div className={`${styles.content}${shopRoutes && pathname === "/club/shop" && (searchParams.get("view") ?? "sell") === "sell" ? ` ${styles.shopSellContent}` : ""}`}>{children}</div>
    </section>
  </div>;
}
