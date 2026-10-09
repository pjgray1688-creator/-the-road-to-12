import styles from "./scheduling-user-guide.module.css";

export function SchedulingUserGuide({ audience }: { audience: "member" | "coach" }) {
  const member = audience === "member";
  return <section className={styles.guide} aria-labelledby={`${audience}-schedule-guide-title`}>
    <header><span className="eyebrow">{member ? "R12 MEMBER GUIDE" : "R12 COACH GUIDE"} · SCHEDULING</span><h2 id={`${audience}-schedule-guide-title`}>{member ? "Your appointments and classes" : "Your diary, at a glance"}</h2><p>{member ? "See what’s coming up and keep track of updates from your Coach or gym." : "Your personal view of sessions, classes, diary blocks and Madhouse rota."}</p></header>
    {member ? <div className={styles.grid}>
      <article><h3>Up Next</h3><p>Your Member home highlights the nearest upcoming appointment or class, including the time, Coach or instructor, and location.</p></article>
      <article><h3>My Schedule</h3><p>Open My Schedule from your Member area to see future PT appointments booked for you and classes you’re confirmed to attend.</p></article>
      <article><h3>Bookings and changes</h3><p>Your Coach or gym books PT sessions for you; PT sessions aren’t self-bookable in R12. If a session is changed or cancelled, R12 can show an in-app update. Class details appear when you’re associated with a confirmed booking.</p></article>
      <article><h3>Your privacy</h3><p>You see only appointments and classes linked to your account. Staff rota, internal availability, private client details and Coach notes aren’t part of your schedule.</p></article>
    </div> : <>
      <div className={styles.coachIntro}><strong>Open Diary from R12 Coach.</strong><span>It opens on your own day view. Move between dates with the arrows or date strip, and use Today to return to the current day.</span></div>
      <div className={styles.grid}>
        <article><h3>PT sessions</h3><p>Choose Add → PT session, then select an R12/Madhouse member or a private client, set the UK date and time, duration, and Madhouse location. Search privately scoped results; or create a private client using their name only. No fake R12 account or membership is created.</p></article>
        <article><h3>Change a booking</h3><p>Open your PT session to edit its time, client, location, notes or status, including completed or no-show where offered. Saving a material member-facing change creates the existing in-app schedule update for a linked Member.</p></article>
        <article><h3>Diary blocks and other gyms</h3><p>Add unavailable time, a personal/admin block, or an other-gym commitment. An other-gym block can include an external location label, such as “XYZ Fitness”. These explicit blocks prevent overlapping PT or class commitments.</p></article>
        <article><h3>Usual availability</h3><p>Optional weekly usual availability is a planning guide, not a booking boundary. No usual availability configuration does not prevent PT bookings.</p></article>
        <article><h3>Rota shifts</h3><p>Rota shifts are gym staffing records set by authorised management and shown quietly in your diary with their Rotherham or Carlton location. They are not the only times you may deliver PT: a Coach with no rota can still book unless there is a real diary conflict or block. Ask management if a rota shift needs changing.</p></article>
        <article><h3>Holiday / leave</h3><p>Request leave from your diary. It remains “Pending approval” until management reviews it; pending leave does not block bookings. Approved leave appears as a block. You can see whether a request is pending, approved or declined and cancel it where available.</p></article>
        <article><h3>Classes and conflicts</h3><p>Hosted classes appear beside your other commitments. Class setup and capacity remain in the Club class tools where your role permits it. A conflict warning means another PT session, class or blocking diary event already overlaps; choose another time or resolve the diary commitment.</p></article>
        <article><h3>Privacy and location</h3><p>Your diary is scoped to you and your organisation. Private client contact information and internal notes are protected; other Coaches’ private diary details aren’t exposed. Members see only their own linked sessions and confirmed classes—not your rota, blocks, leave or notes.</p></article>
      </div>
    </>}
  </section>;
}
