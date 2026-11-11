import { AppShell, PageHeader } from "@/components/ui";
import styles from "./loading.module.css";

export default function ClubClassesLoading() {
  return <AppShell className="module-page club-page club-classes-page">
    <PageHeader title="Classes & PT" />
    <section className={styles.loading} role="status" aria-label="Loading Classes and PT">
      <span className={styles.srOnly}>Loading timetable</span>
      <div className={styles.toolbar}><i /><i /></div>
      <div className={styles.layout} aria-hidden="true">
        <div className={styles.day}><i /><i /></div>
        <div className={styles.cards}>
          {[0, 1, 2].map(item => <div className={styles.card} key={item}>
            <i /><span><i /><i /></span><i /><i />
          </div>)}
        </div>
      </div>
    </section>
  </AppShell>;
}
