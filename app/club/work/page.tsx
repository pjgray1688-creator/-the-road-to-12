import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { submitShiftAction, submitWorkAction } from "./actions";
import { MEMBER_PT_TYPES } from "@/lib/club-work-types";
import type { ScheduleEvent } from "@/lib/club-scheduling";

export default async function ClubWorkPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?app=club&mode=signIn"); const context = await resolveClubOperationalContext(client, user.id, (await searchParams)?.org);
  if (!context) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="My Work" /><EmptyState title="Club staff access required">Your own work submissions are available to authorised Club staff.</EmptyState><AppNav /></AppShell>;
  const params = await searchParams;
  const locations = await context.repository.listLocations(context.organisation.id);
  const locationId = locations.some(location => location.id === params?.location && location.active) ? params?.location : undefined;
  const now = new Date(); const to = new Date(now.getTime() + 14 * 86400000);
  const [workResult, scheduleResult, coachResult] = await Promise.all([
    client.rpc("club_finance_list_work", { p_organisation_id: context.organisation.id, p_staff_user_id: user.id }),
    client.rpc("club_list_shared_schedule", { p_organisation_id: context.organisation.id, p_from: now.toISOString(), p_to: to.toISOString(), p_staff_user_id: user.id, p_location_id: locationId ?? null }),
    client.rpc("coach_has_access", { p_client_user_id: null }),
  ]);
  const rows = Array.isArray(workResult.data) ? workResult.data as Array<Record<string, unknown>> : [];
  const shifts = !scheduleResult.error && Array.isArray(scheduleResult.data) ? (scheduleResult.data as ScheduleEvent[]).filter(event => event.eventType === "rota_shift" || event.eventType === "class" || event.eventType === "pt_session") : [];
  const hidden = <input type="hidden" name="organisationId" value={context.organisation.id}/>;
  return <AppShell className="module-page club-page"><PageHeader title="My Work" /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface className="club-work-shifts"><div className="club-work-heading"><h2>Upcoming shifts &amp; sessions</h2>{coachResult.data === true ? <a className="secondary" href={`/club/classes/diary?org=${encodeURIComponent(context.organisation.id)}`}>Open PT diary</a> : null}</div>{shifts.length ? shifts.map(event => <div className="club-detail-row" key={`${event.eventType}:${event.id}`}><div><strong>{event.title}</strong><span className="muted">{new Date(event.startsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {event.locationName ?? "Location not recorded"}</span></div><span className="status-pill">{event.eventType === "rota_shift" ? "Staff shift" : event.eventType === "class" ? "Class" : "PT session"}</span></div>) : <p className="muted">No shifts, classes or PT sessions are scheduled for you in the next 14 days.</p>}</Surface><Surface><div className="quick-grid"><details open><summary>Log shift</summary><form action={submitShiftAction} className="club-form-grid">{hidden}<label>Date<input type="date" name="workDate" required/></label><label>Started<input type="time" name="start" required/></label><label>Finished<input type="time" name="finish" required/></label><label>Unpaid break (minutes)<input type="number" name="break" min="0" defaultValue="0"/></label><label className="wide">Note (optional)<input name="note" maxLength={240}/></label><button className="primary" type="submit">Submit shift</button></form></details><details><summary>Log PT</summary><form action={submitWorkAction} className="club-form-grid">{hidden}<input type="hidden" name="workType" value="pt"/><label>PT type<select name="ptType" defaultValue="solo">{MEMBER_PT_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Date<input type="date" name="workDate" required/></label><label className="wide">Note (optional)<input name="note" maxLength={240}/></label><button className="secondary" type="submit">Submit PT</button></form></details></div></Surface><Surface><h2>My submissions</h2>{rows.length ? rows.map(row => <div className="club-detail-row" key={String(row.id)}><div><strong>{String(row.work_type).replaceAll("_", " ")}</strong><span className="muted">{String(row.work_date)}{row.start_time ? ` · ${String(row.start_time)}–${String(row.finish_time)} · ${String(row.duration_minutes)}m` : row.duration_minutes ? ` · ${String(row.duration_minutes)}m` : ""}</span></div><span className="status-pill">{String(row.status).replaceAll("_", " ")}</span></div>) : <p className="muted">No work submissions yet.</p>}</Surface><AppNav /></AppShell>;
}
