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
  const [sales, usage, adjustments, lots, customers, identities] = await Promise.all([
    client.from("club_glow_sales").select("id,user_id,actor_user_id,minutes,amount_minor,tender_type,status,created_at").eq("organisation_id", context.organisation.id).eq("location_id", locationId).order("created_at", { ascending: false }).limit(100),
    client.from("club_service_credit_usage").select("id,user_id,actor_user_id,minutes,created_at").eq("organisation_id", context.organisation.id).eq("location_id", locationId).order("created_at", { ascending: false }).limit(100),
    client.from("club_glow_adjustments").select("id,user_id,actor_user_id,minutes,direction,reason,created_at").eq("organisation_id", context.organisation.id).eq("location_id", locationId).order("created_at", { ascending: false }).limit(100),
    client.from("club_service_credit_lots").select("user_id,remaining_quantity,expires_at").eq("organisation_id", context.organisation.id).eq("credit_key", "sunbed_minutes"),
    context.repository.listCustomers(context.organisation.id),
    context.repository.listMemberIdentities(context.organisation.id),
  ]);
  const names = new Map(customers.filter(customer => customer.userId).map(customer => [customer.userId!, customer.displayName]));
  const staff = new Map(identities.map(identity => [identity.userId, identity.displayName ?? identity.email ?? "Staff"]));
  const events: GlowEvent[] = [
    ...((sales.data ?? []) as Array<Record<string, unknown>>).filter(row => row.status === "completed").map(row => ({ id: String(row.id), at: String(row.created_at), userId: String(row.user_id), actorId: String(row.actor_user_id), label: `Minute purchase · ${String(row.tender_type)}`, minutes: Number(row.minutes), amountMinor: Number(row.amount_minor), tender: String(row.tender_type), status: "Completed" })),
    ...((usage.data ?? []) as Array<Record<string, unknown>>).map(row => ({ id: String(row.id), at: String(row.created_at), userId: String(row.user_id), actorId: String(row.actor_user_id), label: "Session QR redemption", minutes: -Number(row.minutes), status: "Redeemed" })),
    ...((adjustments.data ?? []) as Array<Record<string, unknown>>).map(row => ({ id: String(row.id), at: String(row.created_at), userId: String(row.user_id), actorId: String(row.actor_user_id), label: `Manager adjustment · ${String(row.reason)}`, minutes: (row.direction === "add" ? 1 : -1) * Number(row.minutes), status: "Audited" })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
  // The server report needs one consistent point-in-time cutoff for expiring credits.
  // eslint-disable-next-line react-hooks/purity -- This is a server-rendered snapshot, not client render state.
  const now = Date.now();
  const balances = new Map<string, number>();
  for (const row of (lots.data ?? []) as Array<{ user_id: string; remaining_quantity: number; expires_at: string | null }>) {
    if (!row.expires_at || new Date(row.expires_at).getTime() > now) balances.set(row.user_id, (balances.get(row.user_id) ?? 0) + Number(row.remaining_quantity));
  }
  const outstanding = [...balances.entries()].filter(([, minutes]) => minutes > 0).sort((a, b) => b[1] - a[1]);
  const readFailed = Boolean(sales.error || usage.error || adjustments.error || lots.error);
  return <><Surface><h2>Glow Zone activity</h2>{readFailed ? <p role="status">Glow Zone reporting is temporarily unavailable.</p> : events.length ? <div className="club-finance-table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Activity</th><th>Minutes</th><th>Amount</th><th>Recorded by</th><th>Status</th></tr></thead><tbody>{events.map(event => <tr key={`${event.label}:${event.id}`}><td>{new Date(event.at).toLocaleString("en-GB")}</td><td>{names.get(event.userId) ?? "Customer record"}</td><td>{event.label}</td><td>{event.minutes > 0 ? "+" : ""}{event.minutes}</td><td>{event.amountMinor === undefined ? "—" : money(event.amountMinor)}</td><td>{event.actorId ? staff.get(event.actorId) ?? "Staff" : "—"}</td><td>{event.status}</td></tr>)}</tbody></table></div> : <p className="muted">No Glow Zone purchases, redemptions or adjustments have been recorded at Carlton.</p>}</Surface><Surface><h2>Outstanding minute balances</h2>{lots.error ? <p role="status">Balances are temporarily unavailable.</p> : outstanding.length ? <div className="club-finance-table-wrap"><table><thead><tr><th>Customer</th><th>Available minutes</th></tr></thead><tbody>{outstanding.slice(0, 100).map(([userId, minutes]) => <tr key={userId}><td>{names.get(userId) ?? "Customer record"}</td><td>{minutes}</td></tr>)}</tbody></table></div> : <p className="muted">No current Glow Zone minute balances.</p>}</Surface></>;
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
  if(!canManageService||!carlton||accessResult.error||accessResult.data!==true) return <AppShell className="module-page club-page"><PageHeader title="Glow Zone"/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><EmptyState title="Carlton Glow Zone access required">This operation is available to authorised staff assigned to Carlton.</EmptyState><AppNav/></AppShell>;
  const managementView=params?.view==="management"&&canViewFinance;
  return <AppShell className={`module-page club-page ${pageStyles.page}`}><PageHeader title={managementView?"Glow Zone management":"Glow Zone"}/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><main className={pageStyles.main}><GlowZoneReceptionScanner organisationId={context.organisation.id} locationId={carlton.id} canVerifyAge={canVerifyAge}/><ClubSunbedOperations organisationId={context.organisation.id} locations={[carlton]} canAdjust={canAdjustBalance&&(context.role==="owner"||context.role==="gym_admin")} canVerifyAge={canVerifyAge} canRecordCash={canRecordCash} canTakePayment={canTakePayment}/>{managementView?<GlowManagementReport client={client} context={context} locationId={carlton.id}/>:null}</main><AppNav/></AppShell>;
}
