import Link from "next/link";
import { CoachAccountActions } from "@/components/coach-account-actions";
import styles from "./coach-reviewer-demo.module.css";

export type CoachReviewerScreen = "clients" | "diary" | "programmes" | "nutrition" | "account";

const links = <nav className={styles.links} aria-label="Coach demo destinations">
  <Link href="/coach">Clients</Link><Link href="/coach/diary">Diary</Link><Link href="/coach/programmes">Programmes</Link><Link href="/coach/nutrition">Nutrition</Link>
</nav>;

function Notice() {
  return <section className={styles.notice} role="note"><span className={styles.eyebrow}>APP REVIEW DEMO</span><h1>R12 Coach</h1><p>All people, plans and activity shown here are synthetic examples. This demonstration is read-only and does not load or change real member, staff, booking or financial records.</p></section>;
}

function Clients() {
  return <><section className={styles.grid}><article className={styles.card}><span className={styles.eyebrow}>ACTIVE CLIENTS</span><h2>1</h2><p>Independent and gym-linked coaching remain separate.</p></article><article className={styles.card}><span className={styles.eyebrow}>THIS WEEK</span><h2>2 sessions</h2><p>One completed, one scheduled.</p></article></section><section className={styles.card}><span className={styles.eyebrow}>CLIENT WORKSPACE</span><h2>Alex Taylor</h2><p>Independent client · Primary coach</p><div className={styles.row}><span><strong>Foundation Strength</strong><small>Three-day programme · active</small></span><em className={styles.status}>On track</em></div><div className={styles.row}><span><strong>Nutrition plan</strong><small>Performance foundations · review Friday</small></span><em className={styles.status}>Active</em></div><div className={styles.row}><span><strong>Recent activity</strong><small>Lower-body session completed Tuesday · coach note recorded</small></span><em className={styles.status}>Reviewed</em></div>{links}</section></>;
}

function Diary() {
  return <section className={styles.card}><span className={styles.eyebrow}>COACH DIARY · SYNTHETIC</span><h2>Upcoming sessions</h2><p>This preview contains no real bookings and grants no gym staff schedule permission.</p><div className={styles.row}><span><strong>Alex Taylor · Strength session</strong><small>Today · 18:00–19:00 · Independent coaching</small></span><em className={styles.status}>Scheduled</em></div><div className={styles.row}><span><strong>Alex Taylor · Progress review</strong><small>Friday · 17:30–18:00 · Video call</small></span><em className={styles.status}>Scheduled</em></div>{links}</section>;
}

function Programmes() {
  return <section className={styles.card}><span className={styles.eyebrow}>CLIENT PROGRAMME · SYNTHETIC</span><h2>Foundation Strength</h2><p>Example active programme assigned to Alex Taylor. Drafting and activation controls are intentionally disabled in App Review demo mode.</p><div className={styles.row}><span><strong>Day 1 · Lower strength</strong><small>Back squat · Romanian deadlift · Split squat</small></span><em className={styles.status}>6 exercises</em></div><div className={styles.row}><span><strong>Day 2 · Upper strength</strong><small>Bench press · Cable row · Shoulder press</small></span><em className={styles.status}>6 exercises</em></div><div className={styles.row}><span><strong>Day 3 · Full body</strong><small>Trap-bar deadlift · Incline press · Lat pulldown</small></span><em className={styles.status}>5 exercises</em></div>{links}</section>;
}

function Nutrition() {
  return <section className={styles.card}><span className={styles.eyebrow}>NUTRITION · SYNTHETIC</span><h2>Performance foundations</h2><p>Example active plan for Alex Taylor · review Friday.</p><ul className={styles.list}><li>Breakfast: oats, berries and Greek yoghurt</li><li>Lunch: chicken, rice and mixed vegetables</li><li>Training meal: lean protein, potatoes and greens</li><li>Daily targets: regular meals, hydration and pre-training carbohydrate</li></ul><div className={styles.row}><span><strong>Last seven days</strong><small>5 followed · 1 mostly · 1 check-in pending</small></span><em className={styles.status}>Coach reviewed</em></div>{links}</section>;
}

function Account({ email }: { email: string }) {
  return <section className={`${styles.card} ${styles.account}`}><span className={styles.eyebrow}>COACH ACCOUNT</span><h2>App Review Demo</h2><p>{email}</p><div className={styles.row}><span><strong>Coach access</strong><small>Read-only synthetic App Review presentation</small></span><em className={styles.status}>Enabled</em></div><div className={styles.accountActions}><CoachAccountActions/><Link href="/coach/privacy">Privacy policy</Link><Link href="/account/delete">Delete R12 account</Link></div></section>;
}

export function CoachReviewerDemo({ screen, email = "staff@r12.live" }: { screen: CoachReviewerScreen; email?: string }) {
  return <main className={styles.page}><Notice/>{screen === "clients" ? <Clients/> : screen === "diary" ? <Diary/> : screen === "programmes" ? <Programmes/> : screen === "nutrition" ? <Nutrition/> : <Account email={email}/>}</main>;
}
