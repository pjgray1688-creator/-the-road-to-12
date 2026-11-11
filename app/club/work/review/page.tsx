import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { reviewWorkAction } from "../actions";

export default async function ClubWorkReviewPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOperationalContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "staff.work_review"))) return <AppShell className="module-page club-page"><PageHeader title="Work submissions"/><EmptyState title="Review access required">Your current Club permissions do not allow work submission review.</EmptyState><AppNav/></AppShell>;
  const { data } = await client.rpc("club_finance_list_work", { p_organisation_id: context.organisation.id, p_staff_user_id: null });
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const hidden = <input type="hidden" name="organisationId" value={context.organisation.id}/>;
  return <AppShell className="module-page club-page"><PageHeader title="Work submissions"/><Surface>{rows.length ? rows.map(row => <div className="club-detail-row" key={String(row.id)}><span><strong>{String(row.work_type).replaceAll("_", " ")}</strong><small>{String(row.work_date)}{row.start_time ? ` · ${String(row.start_time)}–${String(row.finish_time)} · ${String(row.duration_minutes)}m` : ""}</small></span><span className="status-pill">{String(row.status).replaceAll("_", " ")}</span>{row.status === "pending_approval" ? <form action={reviewWorkAction}>{hidden}<input type="hidden" name="id" value={String(row.id)}/><input type="hidden" name="status" value="approved"/><button className="secondary" type="submit">Approve</button></form> : null}</div>) : <p className="muted">No work submissions awaiting review.</p>}</Surface><AppNav/></AppShell>;
}
