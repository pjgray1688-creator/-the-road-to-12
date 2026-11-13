import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { ClubSunbedOperations } from "@/components/club-sunbed-operations";
import { GlowZoneReceptionScanner } from "@/components/glow-zone-reception-scanner";
import pageStyles from "@/app/club/sunbeds/page.module.css";

type Search = { org?: string; view?: string };
type GlowEvent = { id: string; at: string; userId: string; actorId?: string; label: string; minutes: number; amountMinor?: number; tender?: string; status?: string };
const money = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

async function GlowManagementReport({ client, context, locationId }: { client: Awaited<ReturnType<typeof serverSupabase>>; context: NonNullable<Awaited<ReturnType<typeof resolveClubOperationalContext>>>; locationId: string }) {
  const [reportResult, customers, identities] = await Promise.all([
    client.rpc("club_glow_management_report_secure", { p_organisation_id: context.organisation.id, p_location_id: locationId }),
    context.repository.listCustomers(context.organisation.id),
    context.repository.listMemberIdentities(context.organisation.id),
  ]);
  const report = reportResult.data && typeof reportResult.data === "object" ? reportResult.data as { sales?: Array<Record<string, unknown>>; usage?: Array<Record<string, unknown>>; adjustments?: Array<Record<string, unknown>>; minute_balances?: Array<{ user_id: string; minutes: number }> } : {};
  const salesRows = Array.isArray(report.sales) ? report.sales : [];
  const usageRows = Array.isArray(report.usage) ? report.usage : [];
  const adjustmentRows = Array.isArray(report.adjustments) ? report.adjustments : [];
  const minuteBalances = Array.isArray(report.minute_balances) ? report.minute_balances : [];
  const names = new Map(customers.filter(customer => customer.userId).map(customer => [customer.userId!, customer.displayName]));
  const staff = new Map(identities.map(identity => [identity.userId, identity.displayName ?? identity.email ?? "Staff"]));
  const events: GlowEvent[] = [
    ...salesRows.filter(row => row.status === "completed").map(row => ({ id: String(row.id), at: String(row.created_at), userId: String(row.user_id), actorId: String(row.actor_user_id), label: `Minute purchase · ${String(row.tender_type)}`, minutes: Number(row.minutes), amountMinor: Number(row.amount_minor), tender: String(row.tender_type), status: "Completed" })),
    ...usageRows.map(row => ({ id: String(row.id), at: String(row.created_at), userId: String(row.user_id), actorId: String(row.actor_user_id), label: "Session QR redemption", minutes: -Number(row.minutes), status: "Redeemed" })),
    ...adjustmentRows.map(row => ({ id: String(row.id), at: String(row.created_at), userId: String(row.user_id), actorId: String(row.actor_user_id), label: `Manager adjustment · ${String(row.reason)}`, minutes: (row.direction === "add" ? 1 : -1) * Number(row.minutes), status: "Audited" })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
  const readFailed = Boolean(reportResult.error);
  if (readFailed) console.error("R12_GLOW_REPORT_READ_FAILED", { stage: "club_glow_management_report_secure", code: reportResult.error?.code ?? "UNKNOWN" });
  return <><Surface><h2>Glow Zone activity</h2>{readFailed ? <p role="status">Glow Zone reporting is temporarily unavailable.</p> : events.length ? <div className="club-finance-table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Activity</th><th>Minutes</th><th>Amount</th><th>Recorded by</th><th>Status</th></tr></thead><tbody>{events.map(event => <tr key={`${event.label}:${event.id}`}><td>{new Date(event.at).toLocaleString("en-GB")}</td><td>{names.get(event.userId) ?? "Customer record"}</td><td>{event.label}</td><td>{event.minutes > 0 ? "+" : ""}{event.minutes}</td><td>{event.amountMinor === undefined ? "—" : money(event.amountMinor)}</td><td>{event.actorId ? staff.get(event.actorId) ?? "Staff" : "—"}</td><td>{event.status}</td></tr>)}</tbody></table></div> : <p className="muted">No Glow Zone purchases, redemptions or adjustments have been recorded at Carlton.</p>}</Surface><Surface><h2>Outstanding minute balances</h2>{readFailed ? <p role="status">Glow Zone balances are temporarily unavailable.</p> : minuteBalances.length ? <div className="club-finance-table-wrap"><table><thead><tr><th>Customer</th><th>Available minutes</th></tr></thead><tbody>{minuteBalances.slice(0, 100).map(row=><tr key={row.user_id}><td>{names.get(row.user_id) ?? "Customer record"}</td><td>{row.minutes}</td></tr>)}</tbody></table></div> : <p className="muted">No current Glow Zone minute balances.</p>}</Surface></>;
}

export default async function ClubSunbeds({ searchParams }: { searchParams?: Promise<Search> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const params = await searchParams;
  const context = await resolveClubOperationalContext(client, user.id, params?.org);
  if (!context) return <AppShell className="module-page club-page"><PageHeader title="Glow Zone"/><EmptyState title="Club access required">Choose an authorised Club organisation.</EmptyState><AppNav/></AppShell>;
  const capability = async (name: string) => {
    const { data, error } = await client.rpc("club_capability_allowed", {
      p_organisation_id: context.organisation.id,
      p_user_id: user.id,
      p_capability: name,
    });
    return !error && data === true;
  };
  const [locations, canManageService, canVerifyAge, canRecordCash, canTakePayment, canViewFinance, canAdjustBalance] = await Promise.all([
    context.repository.listLocations(context.organisation.id),
    capability("services.manage"),
    capability("induction.perform"),
    capability("payments.record_cash"),
    capability("payments.take"),
    capability("finance.view"),
    capability("services.manage"),
  ]);
  const carlton=locations.find(location=>location.active&&location.name.toLowerCase().includes("carlton"));
  const accessResult=carlton?await client.rpc("club_location_authorized",{p_organisation_id:context.organisation.id,p_location_id:carlton.id}):{data:false,error:null};
  if(!carlton||accessResult.error||accessResult.data!==true||!canManageService) return <AppShell className="module-page club-page"><PageHeader title="Glow Zone"/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><EmptyState title="Carlton Glow Zone access required">This operation is available to authorised staff assigned to Carlton.</EmptyState><AppNav/></AppShell>;
  const managementRequested=params?.view==="management";
  if(managementRequested&&!canViewFinance) return <AppShell className="module-page club-page"><PageHeader title="Glow Zone management"/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><EmptyState title="Management access required">Glow Zone reporting and balance corrections require the existing finance permission.</EmptyState><AppNav/></AppShell>;
  const managementView=managementRequested;
  return <AppShell className={`module-page club-page ${pageStyles.page}`}><PageHeader title={managementView?"Glow Zone management":"Glow Zone"}/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><main className={pageStyles.main}>{!managementView?<GlowZoneReceptionScanner organisationId={context.organisation.id} locationId={carlton.id} canVerifyAge={canVerifyAge}/>:null}<ClubSunbedOperations organisationId={context.organisation.id} locations={[carlton]} canAdjust={managementView&&canAdjustBalance&&(context.role==="owner"||context.role==="gym_admin")} canVerifyAge={canVerifyAge} canRecordCash={managementView?false:canRecordCash} canTakePayment={managementView?false:canTakePayment} managementMode={managementView}/>{managementView?<GlowManagementReport client={client} context={context} locationId={carlton.id}/>:null}</main><AppNav/></AppShell>;
}
