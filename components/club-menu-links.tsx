import Link from "next/link";
import type { ClubRole } from "@/lib/club";
import { activeClubNavigationPath, clubNavigationLinks } from "@/lib/club-navigation";
import styles from "./club-shell.module.css";
export function ClubMenuLinks({ role, organisationId, locationId, pathname = "", className, onNavigate }: {
  role: ClubRole; organisationId: string; locationId?: string; pathname?: string; className?: string; onNavigate?: () => void;
}) {
  return <nav className={className ?? styles.menuPageLinks} aria-label="Club pages">{clubNavigationLinks(role, organisationId, locationId).map(({ label, href }) => {
    const active = href.split("?")[0] === activeClubNavigationPath(pathname);
    return <Link href={href} key={href} aria-current={active ? "page" : undefined} className={active ? styles.active : undefined} onClick={onNavigate}>{label}</Link>;
  })}</nav>;
}
