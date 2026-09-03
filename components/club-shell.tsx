"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandLockup } from "@/components/brand-lockup";
import type { ClubRole, Organisation } from "@/lib/club";
import styles from "./club-shell.module.css";

type ClubContextOption = { organisation: Organisation; role: ClubRole };

const labelRole = (role: ClubRole) => ({ gym_staff: "Staff", gym_admin: "Admin", owner: "Owner", trainer: "Trainer", member: "Member", guest: "Guest" }[role] ?? role);

export function ClubSectionNav({ organisation, role, contexts = [], locations = [], locationId, branding = false }: { organisation: Organisation; role: ClubRole; contexts?: ClubContextOption[]; locations?: Array<{ id: string; name: string; active: boolean }>; locationId?: string; branding?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const query = (nextLocationId = locationId) => `?org=${encodeURIComponent(organisation.id)}${nextLocationId ? `&location=${encodeURIComponent(nextLocationId)}` : ""}`;
  const operational = ["gym_staff", "gym_admin", "owner"].includes(role);
  const admin = ["gym_admin", "owner"].includes(role);
  const activeVenues = locations.filter(location => location.active);
  const links = operational ? [
    ["Overview", `/club${query()}`], ["Reception", `/club/reception${query()}`], ["Members", `/club/members${query()}`], ["Shop", `/club/shop${query()}`], ["Classes", `/club/classes${query()}`], ["Services", `/club/services${query()}`],
    ...(admin ? [["Locations", `/club/locations${query()}`], ["Induction", `/club/induction${query()}`], ["Staff", `/club/staff${query()}`]] : []),
  ] : role === "trainer" ? [["Classes", `/club/classes${query()}`]] : [["Classes", `/club/classes${query()}`], ["Shop", `/club/shop${query()}`]];
  const canAggregate = role === "gym_admin" || role === "owner";
  return <nav className={styles.nav} aria-label="Club navigation"><div className={styles.identity}><div className={styles.tenant}><span className={styles.tenantMark}><BrandLockup compact /></span><span aria-hidden="true" className={styles.multiply}>×</span><div><span className="eyebrow">CLUB OPERATIONS</span><strong>{organisation.name}</strong></div></div><span className={styles.role}>{labelRole(role)}</span></div><div className={styles.links}>{links.map(([label, href]) => { const hrefPath = href.split("?")[0]; const active = hrefPath === "/club" ? pathname === "/club" : pathname.startsWith(hrefPath); return <Link href={href} key={href} aria-current={active ? "page" : undefined} className={active ? styles.active : undefined}>{label}</Link>; })}</div><div className={styles.contextControls}>{contexts.length > 1 ? <label className={styles.switcher}>Organisation<select aria-label="Choose organisation" defaultValue={organisation.id} onChange={event => router.push(`/club?org=${encodeURIComponent(event.target.value)}`)}>{contexts.map(context => <option key={context.organisation.id} value={context.organisation.id}>{context.organisation.name}</option>)}</select></label> : null}{activeVenues.length ? <label className={styles.switcher}>Venue<select aria-label="Choose operational venue" value={locationId ?? (canAggregate ? "all" : activeVenues[0]?.id)} onChange={event => router.push(`${pathname}${query(event.target.value === "all" ? undefined : event.target.value)}`)}>{canAggregate ? <option value="all">All locations</option> : null}{activeVenues.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}</div></nav>;
}
