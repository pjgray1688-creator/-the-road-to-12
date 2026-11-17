import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubAccessPinControls } from "@/components/club-access-pin-controls";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { MADHOUSE_PRODUCTION_ORGANISATION_ID } from "@/lib/madhouse-catalogue";
import { accessQrMatrix } from "@/lib/qr-code";
import styles from "@/components/club-my-access.module.css";

export const dynamic = "force-dynamic";

const stateLabel: Record<string, string> = { active: "Active staff access", grace: "Active staff access", action_required: "Access needs review", expired: "Expired", cancelled: "Inactive", inactive: "Inactive", not_started: "Not active", no_access: "No access" };

export default async function ClubMyAccessPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn&next=%2Fclub%2Fmy-access");
  const context = await resolveClubOperationalContext(supabase, user.id, (await searchParams)?.org ?? MADHOUSE_PRODUCTION_ORGANISATION_ID);
  if (!context || context.organisation.id !== MADHOUSE_PRODUCTION_ORGANISATION_ID) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="My Access" /><EmptyState title="Active Madhouse staff access required">This page is for your own Madhouse staff door credentials. A paid gym membership is not required.</EmptyState><AppNav /></AppShell>;
  }

  const [{ data, error }, canReset] = await Promise.all([
    supabase.rpc("club_get_my_access_pass", { p_organisation_id: context.organisation.id }),
    context.repository.hasCapability(context.organisation.id, user.id, "members.link_account").catch(() => false),
  ]);
  const pass = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
  const accessAllowed = !error && pass?.accessAllowed === true;
  const qrToken = accessAllowed && typeof pass?.qrToken === "string" ? pass.qrToken : undefined;
  const matrix = qrToken ? accessQrMatrix(qrToken) : [];
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const modules = matrix.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : "")).join("");
  const locations = await context.repository.listLocations(context.organisation.id).catch(() => []);
  const enabledMadhouseVenues = locations.filter(location => location.active && /^(madhouse gym )?(rotherham|carlton)$/i.test(location.name.trim())).map(location => location.name);

  return <AppShell className="module-page club-page club-my-access-page">
    <PageHeader eyebrow="R12 CLUB · STAFF" title="My Access" description="Your personal gym-entry credentials. No paid membership or Member Hub account is required." />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts ?? [{ organisation: context.organisation, role: context.role, navigation: context.navigation }]} />
    {error ? <EmptyState title="Your access credentials could not be loaded">Try again shortly. No PIN or QR has been shown.</EmptyState>
      : accessAllowed && qrToken ? <Surface className={styles.card}>
        <div className="section-heading-row"><div><span className="eyebrow">STAFF ACCESS</span><h2>{stateLabel[String(pass?.accessState)] ?? "Active"}</h2></div><strong>READY</strong></div>
        <p className="muted">Use your own PIN or QR at authorised Madhouse gym access points.</p>
        {enabledMadhouseVenues.length ? <p className={styles.venues}><strong>Current venues:</strong> {enabledMadhouseVenues.join(" · ")}</p> : <p role="status" className="muted">Venue access configuration could not be verified. Contact a manager before relying on this pass.</p>}
        <div className={styles.qrWrap}><svg aria-label="Your personal Madhouse staff access QR" role="img" viewBox={`0 0 ${size} ${size}`} width={320} height={320} shapeRendering="crispEdges"><rect width={size} height={size} fill="white"/><path d={modules} fill="black"/></svg></div>
        <p className="muted">Door entry is authorised live by R12. Staff role and venue access must remain active.</p>
        <div className={styles.pinControls}><ClubAccessPinControls organisationId={context.organisation.id} canReset={canReset} /></div>
      </Surface>
      : <Surface><span className="eyebrow">STAFF ACCESS</span><h2>{stateLabel[String(pass?.accessState)] ?? "Not available"}</h2><p role="status" className="muted">Your current staff access projection does not permit a gym entry credential to be shown. Ask a Madhouse manager to check your active staff role and venue configuration. A paid membership is not required for staff access.</p></Surface>}
    <AppNav />
  </AppShell>;
}
