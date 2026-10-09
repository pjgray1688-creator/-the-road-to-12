import Link from "next/link";
import styles from "./coach-navigation.module.css";

export function CoachNavigation({ active, organisationId }: { active: "home" | "diary"; organisationId?: string }) {
  const diary = organisationId ? `/coach/diary?org=${encodeURIComponent(organisationId)}` : "/coach/diary";
  return <nav className={styles.nav} aria-label="R12 Coach">
    <Link href="/coach" aria-current={active === "home" ? "page" : undefined} className={active === "home" ? styles.selected : ""}>Workspace</Link>
    <Link href={diary} aria-current={active === "diary" ? "page" : undefined} className={active === "diary" ? styles.selected : ""}>Diary</Link>
    <Link href="/tutorial/coach">Guide</Link>
  </nav>;
}
