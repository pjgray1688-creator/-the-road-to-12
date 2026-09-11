import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function SupplierImportHistoryPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org); if (!context || !(await context.repository.hasCapability(context.organisation.id,user.id,"supplier.catalogue_manage"))) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Import history" /><EmptyState title="Management access required">Supplier import history is limited to authorised Club managers.</EmptyState><AppNav /></AppShell>;
  const { data } = await client.rpc("club_list_supplier_import_jobs", { p_organisation_id: context.organisation.id }); const jobs = Array.isArray(data) ? data as Array<Record<string,unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · COMMERCE" title="Supplier import history" description="Review background catalogue publishes and their stage logs." /><section className="card"><div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Filename</th><th>Started</th><th>Completed</th><th>Duration</th><th>Status</th></tr></thead><tbody>{jobs.map(job=><tr key={String(job.id)}><td>Supplier</td><td>{String(job.filename)}</td><td>{String(job.started_at ?? "Queued")}</td><td>{String(job.completed_at ?? "—")}</td><td>{job.duration_ms ? `${job.duration_ms}ms` : "—"}</td><td>{String(job.status)}</td></tr>)}</tbody></table></div>{!jobs.length ? <p className="muted">No supplier imports yet.</p> : null}</section><BackButton href={`/club/products?org=${encodeURIComponent(context.organisation.id)}`}>Back to Products &amp; Pricing</BackButton><AppNav /></AppShell>;
}
