import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubMembersDirectory } from "@/components/club-members-directory";
import { ClubClassesWorkspace } from "@/components/club-classes";
import { ClubClassRegister } from "@/components/club-class-register";
import { ClubChecks } from "@/components/club-checks";
import { ClubShop } from "@/components/club-shop";
import { GlowZoneOpeningHours } from "@/components/glow-zone-opening-hours";
import { serverSupabase } from "@/lib/supabase-server";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { reviewerGlowHours } from "@/lib/play-reviewer-member-data";
import {
  reviewerClubAttendance, reviewerClubCheckData, reviewerClubClassTypes, reviewerClubCustomers,
  reviewerClubLocations, reviewerClubMembers, reviewerClubOrganisation, reviewerClubProducts,
  reviewerClubRole, reviewerClubRoster, reviewerClubSession, reviewerClubSessions, reviewerClubStaff,
  reviewerClubUserId,
} from "@/lib/play-reviewer-club-data";
import styles from "@/components/club-operations.module.css";

const londonToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const syntheticCheckData = reviewerClubCheckData as unknown as Parameters<typeof ClubChecks>[0]["data"];

function ReviewNotice() {
  return <Surface className="play-reviewer-notice"><span className="eyebrow">GOOGLE PLAY REVIEW · READ ONLY</span><p>All people, memberships, attendance, shifts, classes, checks and products on these screens are synthetic examples. Club changes, payments, refunds and door access are disabled.</p></Surface>;
}

function AttendanceDemo() {
  return <Surface><div className="section-header"><div><span className="eyebrow">SAMPLE ATTENDANCE</span><h2>Recent arrivals</h2><p className="muted">Example register only. This is not connected to a physical station or live attendance.</p></div></div>{reviewerClubAttendance.map((row, index) => <div className="club-detail-row" key={`${row.name}-${index}`}><div><strong>{row.name}</strong><span className="muted">{row.location} · {row.time}</span></div><span className="status-pill">{row.status}</span></div>)}</Surface>;
}

function MemberDemo({ memberId, unlinked = false }: { memberId?: string; unlinked?: boolean }) {
  const member = reviewerClubMembers.find(item => item.userId === memberId) ?? reviewerClubMembers[0];
  return <Surface><span className="eyebrow">SYNTHETIC {unlinked ? "CUSTOMER" : "MEMBER"} RECORD</span><h2>{unlinked ? "Jamie Parker" : member.displayName}</h2><div className="club-detail-list"><div className="club-detail-row"><span>Membership</span><strong>{unlinked ? "No membership linked" : member.membershipName}</strong></div><div className="club-detail-row"><span>Status</span><strong>{unlinked ? "Account not linked · demo" : member.membershipStatus === "active" ? "Active · demo" : "Needs attention · demo"}</strong></div><div className="club-detail-row"><span>Home venue</span><strong>{unlinked ? "Not set" : member.homeLocation?.name}</strong></div><div className="club-detail-row"><span>Gym access</span><strong>{unlinked ? "Not available" : member.accessState === "active" ? "Example active state" : "Example review state"}</strong></div></div><p className="muted">This synthetic record cannot be edited and does not grant gym access.</p></Surface>;
}

function StaffOperations() {
  return <Surface><div className="section-header"><div><span className="eyebrow">SYNTHETIC STAFF ROSTER</span><h2>Today’s operations</h2></div></div>{reviewerClubStaff.map(row => <div className="club-detail-row" key={row.name}><div><strong>{row.name}</strong><span className="muted">{row.role} · {row.location}</span></div><span className="status-pill">{row.status} · example</span></div>)}</Surface>;
}

function InductionDemo() {
  return <><Surface><span className="eyebrow">INDUCTION · EXAMPLE POLICY</span><h2>New member introduction</h2><p className="muted">This read-only sample shows the production Club induction information layout. No member induction record is loaded.</p><div className="club-detail-list">{["Emergency exits and fire procedure", "Safe use of gym equipment", "How to ask for staff support", "Member access and venue conduct"].map((item, i) => <div className="club-detail-row" key={item}><strong>{i + 1}. {item}</strong><span className="muted">Example topic</span></div>)}</div></Surface><Surface><span className="eyebrow">COMPLETION</span><h2>Example induction status</h2><p className="muted">No real person has been inducted. Record and policy controls are unavailable to the review account.</p></Surface></>;
}

function WorkDemo() {
  return <><StaffOperations/><Surface><span className="eyebrow">MY WORK · EXAMPLE</span><h2>Recent work log</h2><div className="club-detail-list">{[{ day: "Monday", shift: "14:00–20:00", place: "Carlton" }, { day: "Tuesday", shift: "12:00–18:00", place: "Rotherham" }].map(row => <div className="club-detail-row" key={row.day}><div><strong>{row.day} · {row.shift}</strong><span className="muted">{row.place} · synthetic rota example</span></div><span className="status-pill">Approved · example</span></div>)}</div></Surface></>;
}

function ScheduleDemo() {
  return <Surface><span className="eyebrow">SCHEDULE · EXAMPLE</span><h2>Upcoming activities</h2><div className="club-detail-list">{reviewerClubSessions.slice(0, 4).map(session => <div className="club-detail-row" key={session.id}><div><strong>{session.title}</strong><span className="muted">{session.locationId === reviewerClubLocations[0].id ? "Rotherham" : "Carlton"} · Coach Morgan</span></div><span>{new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(session.startsAt))}</span></div>)}</div><p className="muted">Example timetable only. No real appointments are read or changed.</p></Surface>;
}

function RestrictedDemo({ screen }: { screen: string }) {
  const labels: Record<string, string> = { access: "Physical door access", stations: "Door stations", lock: "Station lock", staff: "Staff account and permission management", payments: "Finance and payment records", "membership-billing": "Membership billing", "shop/balance": "Stored value and balance", "shop/collections": "Member order collections", "staff/email-preview": "Staff invitation and email administration", privacy: "Club privacy administration", reports: "Operational reports", "members/import": "Member data import" };
  return <Surface><span className="eyebrow">NOT INCLUDED IN REVIEW ACCESS</span><h2>{labels[screen] ?? "Restricted Club operation"}</h2><p className="muted">This area can expose live personal, financial, staff-permission or physical-access controls. It is not available to the read-only Google Play reviewer.</p><p className="muted">No production records were loaded or changed.</p></Surface>;
}

export default async function ClubReviewerPage({ params }: { params: Promise<{ screen?: string[] }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub");
  if (!hasPlayReviewerEntitlement(user)) notFound();
  const path = (await params).screen ?? [];
  const screen = path[0] ?? "overview";
  if (screen === "manifest.webmanifest") notFound();
  const organisation = reviewerClubOrganisation;
  const locations = reviewerClubLocations;
  let title = "Club dashboard";
  let content: ReactNode;

  if (screen === "overview" || screen === "members" && !path[1]) {
    title = screen === "members" ? "Member management" : "Club dashboard";
    content = <>
      <Surface><span className="eyebrow">OPERATIONS OVERVIEW</span><h2>Madhouse Gym · example workspace</h2><div className={styles.quickGrid}><Link href="/club/checks"><strong>Daily checks</strong><small>Review a synthetic venue checklist</small></Link><Link href="/club/classes"><strong>Classes</strong><small>View the sample timetable and register</small></Link><Link href="/club/check-in"><strong>Check-in and attendance</strong><small>Read-only example arrival list</small></Link><Link href="/club/shop"><strong>Shop operations</strong><small>Browse the synthetic catalogue</small></Link><Link href="/club/induction"><strong>Inductions</strong><small>Review an example induction flow</small></Link><Link href="/club/work"><strong>Staff operations</strong><small>View sample rota and work logs</small></Link></div></Surface>
      <Surface><span className="eyebrow">MEMBER MANAGEMENT</span><h2>Members</h2><p className="muted">Search and filter sample membership records using the production Club directory.</p><ClubMembersDirectory members={reviewerClubMembers} customers={reviewerClubCustomers} organisationId={organisation.id}/></Surface>
      <Surface><span className="eyebrow">UP NEXT</span><h2>Classes at Madhouse Gym</h2><ClubClassesWorkspace classTypes={reviewerClubClassTypes} sessions={reviewerClubSessions} locations={locations} members={[]} availability={Object.fromEntries(reviewerClubSessions.map(session => [session.id, { sessionId: session.id, capacity: 6, confirmedCount: 2, spacesRemaining: 4, waitlistedCount: 0, isFull: false }]))} role={reviewerClubRole} currentUserId={reviewerClubUserId} today={londonToday} accent="#a855f7" organisationId={organisation.id} readOnly/></Surface>
    </>;
  } else if (screen === "check-in" || screen === "reception") {
    title = "Check-in and attendance";
    content = <AttendanceDemo/>;
  } else if (screen === "checks") {
    title = "Daily checks";
    content = <ClubChecks organisationId={organisation.id} locationId={locations[0].id} locationName={locations[0].name} data={syntheticCheckData} locations={locations} canReview={false} canSubmit={false} readOnly/>;
  } else if (screen === "classes") {
    title = path[1] && path[1] !== "reports" ? reviewerClubSession(path[1])?.title ?? "Class register" : path[1] === "reports" ? "Class reports" : "Classes";
    const session = path[1] && path[1] !== "reports" ? reviewerClubSession(path[1]) : undefined;
    content = session ? <><Surface><span className="eyebrow">SAMPLE CLASS REGISTER</span><h2>{session.title} · {locations.find(location => location.id === session.locationId)?.name}</h2><p className="muted">{new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" }).format(new Date(session.startsAt))} · Coach Morgan · six places</p></Surface><ClubClassRegister sessionId={session.id} capacity={6} reserved={reviewerClubRoster.length} roster={reviewerClubRoster} members={[]} canCollectCash={false} canReconcileCash={false} readOnly/></> : path[1] === "reports" ? <Surface><span className="eyebrow">CLASS REPORTS · EXAMPLE</span><h2>Bookings and cancellations</h2><p className="muted">Synthetic report preview. Includes sample attendance and funding states only; no member booking history or financial records are loaded.</p><div className="club-detail-row"><strong>Upcoming sessions</strong><span>{reviewerClubSessions.length} · sample</span></div><div className="club-detail-row"><strong>Repeat cancellations</strong><span>1 · sample, no automatic penalty</span></div></Surface> : <ClubClassesWorkspace classTypes={reviewerClubClassTypes} sessions={reviewerClubSessions} locations={locations} members={[]} availability={Object.fromEntries(reviewerClubSessions.map(item => [item.id, { sessionId: item.id, capacity: 6, confirmedCount: 2, spacesRemaining: 4, waitlistedCount: 0, isFull: false }]))} role={reviewerClubRole} currentUserId={reviewerClubUserId} today={londonToday} accent="#a855f7" organisationId={organisation.id} readOnly/>;
  } else if (screen === "shop" || screen === "products") {
    title = screen === "products" ? "Products and catalogue" : "Shop operations";
    content = <ClubShop organisationId={organisation.id} userId={reviewerClubUserId} products={reviewerClubProducts} locations={locations} balance={{ id: "demo-balance", organisationId: organisation.id, customerId: "demo-customer", currency: "GBP", status: "active", balanceMinor: 1250 }} orders={[]} declarations={[]} staff={false} canReconcile={false} accent="#a855f7" currentLocationId={locations[1].id} stockBalances={[]} promotions={[]} demoMode/>;
  } else if (screen === "induction") {
    title = "Inductions";
    content = <InductionDemo/>;
  } else if (screen === "work") {
    title = "Staff operations";
    content = <WorkDemo/>;
  } else if (screen === "schedule") {
    title = "Schedule";
    content = <ScheduleDemo/>;
  } else if (screen === "sunbeds") {
    title = "Glow Zone operations";
    content = <><Surface><span className="eyebrow">GLOW ZONE · CARLTON</span><h2>Example sunbed service</h2><p className="muted">The gym remains open 24 hours. These are Glow Zone service hours only.</p></Surface><GlowZoneOpeningHours hours={reviewerGlowHours}/></>;
  } else if (screen === "members" && path[1]) {
    title = "Member record";
    content = <MemberDemo memberId={path[1] === "customer" ? undefined : path[1]} unlinked={path[1] === "customer"}/>;
  } else {
    const key = path.join("/");
    title = key.split("/").at(-1)?.replaceAll("-", " ").replace(/\b\w/g, letter => letter.toUpperCase()) ?? "Club";
    content = <RestrictedDemo screen={key}/>;
  }

  return <AppShell className="module-page club-page club-reviewer-page"><PageHeader eyebrow="R12 CLUB · GOOGLE PLAY REVIEW" title={title} description="Production Club interface with isolated synthetic review data."/><ReviewNotice/><ClubSectionNav organisation={organisation} role={reviewerClubRole} locations={locations} roleLabelOverride="Review only"/>{content}<BackButton href="/club">Back to Club dashboard</BackButton><AppNav/></AppShell>;
}
