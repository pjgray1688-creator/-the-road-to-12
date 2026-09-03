"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClubRole, Organisation } from "@/lib/club";
import styles from "./club-shell.module.css";

type ClubContextOption = { organisation: Organisation; role: ClubRole };

const labelRole = (role: ClubRole) => ({ gym_staff: "Staff", gym_admin: "Admin", owner: "Owner", trainer: "Trainer", member: "Member", guest: "Guest" }[role] ?? role);

export function ClubSectionNav({ organisation, role, contexts = [] }: { organisation: Organisation; role: ClubRole; contexts?: ClubContextOption[] }) {
  const router = useRouter();
  const query = `?org=${encodeURIComponent(organisation.id)}`;
  const operational = ["gym_staff", "gym_admin", "owner"].includes(role);
  const admin = ["gym_admin", "owner"].includes(role);
  const links = operational ? [
    ["Overview", `/club${query}`], ["Members", `/club/members${query}`], ["Classes", `/club/classes${query}`],
    ["Reception", `/club/shop${query}`], ["Services", `/club/services${query}`], ["Locations", `/club/locations${query}`],
    ...(admin ? [["Induction", `/club/induction${query}`]] : []),
  ] : role === "trainer" ? [["Classes", `/club/classes${query}`]] : [["Classes", `/club/classes${query}`], ["Shop", `/club/shop${query}`]];
  return <nav className={styles.nav} aria-label="Club navigation"><div className={styles.identity}><span className={styles.mark} aria-hidden="true">12</span><div><span className="eyebrow">R12 CLUB</span><strong>{organisation.name}</strong></div><span className={styles.role}>{labelRole(role)}</span></div><div className={styles.links}>{links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</div>{contexts.length > 1 ? <label className={styles.switcher}>Organisation<select aria-label="Choose organisation" defaultValue={organisation.id} onChange={event => router.push(`/club?org=${encodeURIComponent(event.target.value)}`)}>{contexts.map(context => <option key={context.organisation.id} value={context.organisation.id}>{context.organisation.name}</option>)}</select></label> : null}</nav>;
}
