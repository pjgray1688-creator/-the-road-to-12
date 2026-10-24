"use client";
import { ClubMenuLinks } from "./club-menu-links";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ClubRole, Organisation } from "@/lib/club";
import styles from "./club-shell.module.css";
type ClubContextOption = { organisation: Organisation; role: ClubRole };
const labelRole = (role: ClubRole) => ({ gym_staff: "Staff", gym_admin: "Admin", owner: "Owner", trainer: "Trainer", member: "Member", guest: "Guest" }[role] ?? role);
export function ClubSectionNav({ organisation, role, contexts = [], locations = [], locationId, branding = false, roleLabelOverride }: { organisation: Organisation; role: ClubRole; contexts?: ClubContextOption[]; locations?: Array<{ id: string; name: string; active: boolean }>; locationId?: string; branding?: boolean; roleLabelOverride?: string }) {
  const router = useRouter(); const pathname = usePathname(); const [mobileOpen,setMobileOpen]=useState(false); const [menuPath,setMenuPath]=useState(pathname); const closeButtonRef=useRef<HTMLButtonElement>(null); const menuButtonRef=useRef<HTMLButtonElement>(null); const menuVisible=mobileOpen&&menuPath===pathname;
  useEffect(()=>{if(!menuVisible)return;const previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";closeButtonRef.current?.focus();const handleMenuKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){setMobileOpen(false);requestAnimationFrame(()=>menuButtonRef.current?.focus());return}if(event.key!=="Tab")return;const menu=document.getElementById("club-mobile-menu");const focusable=menu?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select:not([disabled])');if(!focusable?.length)return;const first=focusable[0];const last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};window.addEventListener("keydown",handleMenuKey);return()=>{document.body.style.overflow=previousOverflow;window.removeEventListener("keydown",handleMenuKey)}},[menuVisible]);
  const query = (nextLocationId = locationId) => `?org=${encodeURIComponent(organisation.id)}${nextLocationId ? `&location=${encodeURIComponent(nextLocationId)}` : ""}`;
  const activeVenues = locations.filter(location => location.active);
  const canAggregate = role === "gym_admin" || role === "owner";
  const closeMenu=()=>{setMobileOpen(false);requestAnimationFrame(()=>menuButtonRef.current?.focus())};
  const renderOrganisation = (compact=false) => contexts.length > 1 ? <label className={styles.switcher}>{compact ? <span className={styles.visuallyHidden}>Choose organisation</span> : <span>Choose organisation</span>}<select aria-label="Choose organisation" value={organisation.id} onChange={event=>{closeMenu();router.push(`/club?org=${encodeURIComponent(event.target.value)}`)}}>{contexts.map(context=><option key={context.organisation.id} value={context.organisation.id}>{context.organisation.name}</option>)}</select></label> : null;
  const renderVenue = (compact=false) => activeVenues.length ? <label className={styles.switcher}>{compact ? <span className={styles.visuallyHidden}>Choose venue</span> : <span>Choose venue</span>}<select aria-label="Choose operational venue" value={locationId ?? (canAggregate ? "all" : activeVenues[0]?.id)} onChange={event=>{closeMenu();router.push(`${pathname}${query(event.target.value === "all" ? undefined : event.target.value)}`)}}>{canAggregate ? <option value="all">All locations</option> : null}{activeVenues.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null;
  return <nav className={styles.nav} aria-label="Club workspace navigation">
    <div className={styles.identity}>
      <div className={styles.tenant}><strong>{organisation.name}</strong></div>
      <span className={styles.role}>{roleLabelOverride ?? labelRole(role)}</span>
      <button ref={menuButtonRef} type="button" className={styles.menuButton} aria-expanded={menuVisible} aria-controls="club-mobile-menu" onClick={()=>{setMenuPath(pathname);setMobileOpen(true)}}>Menu</button>
    </div>
    <ClubMenuLinks role={role} organisationId={organisation.id} locationId={locationId} pathname={pathname} className={styles.links}/>

    <div className={`${styles.contextControls} ${styles.desktopContext}`}>{renderOrganisation()}{renderVenue()}</div>
    {menuVisible ? <div id="club-mobile-menu" className={styles.mobileMenu} role="dialog" aria-modal="true" aria-label="Club navigation menu">
      <div className={styles.mobileMenuHeader}><div><small>Club workspace</small><strong>{organisation.name}</strong></div><button ref={closeButtonRef} type="button" className={styles.closeButton} aria-label="Close navigation" onClick={closeMenu}>×</button></div>
      <div className={styles.mobileNavigation}><ClubMenuLinks role={role} organisationId={organisation.id} locationId={locationId} pathname={pathname} className={styles.mobileLinks} onNavigate={closeMenu}/></div>

      <div className={styles.mobileContexts}>{contexts.length > 1 ? <section aria-label="Organisation selector"><h2>Organisation</h2>{renderOrganisation(true)}</section> : null}{activeVenues.length ? <section aria-label="Venue selector"><h2>Venue</h2>{renderVenue(true)}</section> : null}</div>
    </div> : null}
  </nav>;
}
