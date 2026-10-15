import Link from "next/link";
import styles from "./coach-client-section-nav.module.css";

const items = [
  { key: "overview", label: "Overview" },
  { key: "programme", label: "Programme" },
  { key: "nutrition", label: "Nutrition" },
  { key: "history", label: "Sessions" },
  { key: "progress", label: "Progress" },
] as const;

export function CoachClientSectionNav({ clientUserId, active }: { clientUserId: string; active: typeof items[number]["key"] }) {
  return <nav className={styles.nav} aria-label="Client workspace">
    {items.map(item => {
      const href = item.key === "nutrition"
        ? `/coach/nutrition?client=${encodeURIComponent(clientUserId)}`
        : `/coach?client=${encodeURIComponent(clientUserId)}${item.key === "overview" ? "" : `&section=${item.key}`}`;
      return <Link key={item.key} href={href} aria-current={active === item.key ? "page" : undefined} className={active === item.key ? styles.active : ""}>{item.label}</Link>;
    })}
  </nav>;
}
