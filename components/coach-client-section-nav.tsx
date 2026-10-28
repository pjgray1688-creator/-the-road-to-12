import Link from "next/link";
import styles from "./coach-client-section-nav.module.css";

const items = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "Workout History" },
  { key: "progress", label: "Progress / Measurements" },
  { key: "programme", label: "Programme" },
  { key: "nutrition", label: "Nutrition" },
  { key: "diary", label: "Sessions / Diary" },
] as const;

export function CoachClientSectionNav({ clientUserId, active }: { clientUserId: string; active: Exclude<typeof items[number]["key"], "diary"> }) {
  return <nav className={styles.nav} aria-label="Client workspace">
    {items.map(item => {
      const href = item.key === "diary"
        ? "/coach/diary"
        : item.key === "nutrition"
        ? `/coach/nutrition?client=${encodeURIComponent(clientUserId)}`
        : `/coach?client=${encodeURIComponent(clientUserId)}${item.key === "overview" ? "" : `&section=${item.key}`}`;
      return <Link key={item.key} href={href} aria-current={active === item.key ? "page" : undefined} className={active === item.key ? styles.active : ""}>{item.label}</Link>;
    })}
  </nav>;
}
