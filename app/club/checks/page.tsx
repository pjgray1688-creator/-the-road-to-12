import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubChecks } from "@/components/club-checks";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";

export default async function ClubChecksPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const params = await searchParams; const context = await resolveClubOperationalContext(client, user.id, params?.org);
  if (!context) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Daily checks" /><EmptyState title="Club staff access required">Daily venue checks are available to authorised staff only.</EmptyState><AppNav /></AppShell>;
  const [locations, canSubmit, canReview] = await Promise.all([context.repository.listLocations(context.organisation.id), context.repository.hasCapability(context.organisation.id, user.id, "staff.work_submit"), context.repository.hasCapability(context.organisation.id, user.id, "staff.work_review")]);
  if (!canSubmit && !canReview) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Daily checks" /><EmptyState title="Daily checks access required">Your Club role does not include venue checks.</EmptyState><AppNav /></AppShell>;
  const locationAccess = canReview ? null : await client.from("club_staff_location_access").select("location_id").eq("organisation_id", context.organisation.id).eq("user_id", user.id);
  const allowedLocationIds = new Set((locationAccess?.data ?? []).map(row => String(row.location_id)));
  const allowedLocations = canReview ? locations : locations.filter(location => location.active && allowedLocationIds.has(location.id));
  let locationId = params?.location && allowedLocations.some(location => location.id === params.location) ? params.location : allowedLocations[0]?.id;
  if (!locationId) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Daily checks" /><EmptyState title="No venue access assigned">Ask a manager to assign your staff account to a venue.</EmptyState><AppNav /></AppShell>;
  if (!canReview && params?.location) { const access = await client.rpc("club_location_authorized", { p_organisation_id: context.organisation.id, p_location_id: params.location }); if (access.error || access.data !== true) locationId = allowedLocations[0]?.id; }
  const location = locations.find(item => item.id === locationId); if (!location) return null;
  const [dailyResult, overviewResult] = await Promise.all([client.rpc("club_get_venue_daily_checks", { p_organisation_id: context.organisation.id, p_location_id: locationId }), canReview ? client.rpc("club_list_venue_check_overview", { p_organisation_id: context.organisation.id }) : Promise.resolve({ data: null, error: null })]);
  const data = !dailyResult.error && dailyResult.data && typeof dailyResult.data === "object" ? dailyResult.data as Record<string, unknown> : {};
  const overview = Array.isArray(overviewResult.data) ? overviewResult.data as Array<Record<string, unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · OPERATIONS" title="Daily checks" description="Complete today’s venue and equipment checks, report faults, and keep unsafe equipment visible." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} locations={locations} locationId={locationId} />{canReview ? <Surface><div className="section-header"><div><span className="eyebrow">MANAGER OVERVIEW</span><h2>Venue completion</h2><p className="muted">Review today’s progress across every active venue.</p></div></div>{overview.length ? overview.map(row => <div className="club-detail-row" key={String(row.location_id)}><div><strong>{String(row.location_name)}</strong><span className="muted">{Number(row.item_done ?? 0) + Number(row.equipment_done ?? 0)} / {Number(row.item_total ?? 0) + Number(row.equipment_total ?? 0)} complete · {Number(row.unresolved_issues ?? 0)} unresolved faults · {String(row.submitted_by_name ?? "Not submitted")}</span></div><span className={String(row.submitted) === "true" ? "status-pill" : "status-pill status-muted"}>{String(row.submitted) === "true" ? "Submitted" : "In progress"}</span><a className="secondary" href={`/club/checks?org=${encodeURIComponent(context.organisation.id)}&location=${encodeURIComponent(String(row.location_id))}`}>Open</a></div>) : <p className="muted">No active venues configured.</p>}</Surface> : null}<ClubChecks organisationId={context.organisation.id} locationId={location.id} locationName={location.name} data={data} locations={locations} canReview={canReview} /><AppNav /></AppShell>;
}
