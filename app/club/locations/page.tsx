/* eslint-disable react-hooks/error-boundaries */
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOperationalContext, isClubStaffRole } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import styles from "@/components/club-operations.module.css";
import { ClubAkuvoxDeviceAdmin } from "@/components/club-akuvox-device-admin";

export default async function ClubLocationsPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  try {
    const context = await resolveClubOperationalContext(client, user.id, (await searchParams)?.org);
    if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Locations" description="Location management is restricted to Club operations staff." /><EmptyState title="Club access required">Choose an authorised organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
    const locations = await context.repository.listLocations(context.organisation.id);
    const canManageAkuvox = context.role === "owner" || context.role === "gym_admin";
    let akuvoxData: { location: { id: string; name: string; active: boolean; accessMode: string } | null; devices: Array<{ id: string; name: string; status: "active" | "disabled"; locationId: string; createdAt: string; lastSeenAt: string | null }> } | null = null;
    let durationSetting: { requestedSeconds: number; saved: boolean; hardwareVerified: boolean; hardwareVerifiedAt: string | null; hardwareReadbackSeconds: number | null } | null = null;
    if (canManageAkuvox) {
      const { data } = await client.rpc("club_list_rotherham_akuvox_devices", { p_organisation_id: context.organisation.id });
      if (data && typeof data === "object") {
        const value = data as Record<string, unknown>;
        const rawLocation = value.location && typeof value.location === "object" ? value.location as Record<string, unknown> : null;
        const rawDevices = Array.isArray(value.devices) ? value.devices : [];
        const location = rawLocation && typeof rawLocation.id === "string" && typeof rawLocation.name === "string"
          ? { id: rawLocation.id, name: rawLocation.name, active: rawLocation.active === true, accessMode: typeof rawLocation.accessMode === "string" ? rawLocation.accessMode : "UNKNOWN" }
          : null;
        const devices = rawDevices.flatMap(item => {
          if (!item || typeof item !== "object") return [];
          const device = item as Record<string, unknown>;
          if (typeof device.id !== "string" || typeof device.name !== "string" || (device.status !== "active" && device.status !== "disabled") || typeof device.locationId !== "string") return [];
          return [{ id: device.id, name: device.name, status: device.status as "active" | "disabled", locationId: device.locationId, createdAt: typeof device.createdAt === "string" ? device.createdAt : "", lastSeenAt: typeof device.lastSeenAt === "string" ? device.lastSeenAt : null }];
        });
        akuvoxData = { location, devices };
      }
      const { data: durationData } = await client.rpc("club_get_rotherham_door_duration_request", { p_organisation_id: context.organisation.id });
      if (durationData && typeof durationData === "object") {
        const value = durationData as Record<string, unknown>;
        if (typeof value.requestedSeconds === "number" && value.requestedSeconds >= 3 && value.requestedSeconds <= 10) {
          durationSetting = {
            requestedSeconds: value.requestedSeconds,
            saved: value.saved === true,
            hardwareVerified: value.hardwareVerified === true,
            hardwareVerifiedAt: typeof value.hardwareVerifiedAt === "string" ? value.hardwareVerifiedAt : null,
            hardwareReadbackSeconds: typeof value.hardwareReadbackSeconds === "number" ? value.hardwareReadbackSeconds : null,
          };
        }
      }
    }
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · LOCATIONS" title="Locations" description="Active sites and operational location context." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface>{locations.length ? locations.map(location => <div className="club-detail-row" key={location.id}><div><strong>{location.name}</strong><span className="muted">{location.active ? "Available for operations" : "Inactive location"}</span></div><span className={`${styles.status} ${location.active ? "" : styles.statusMuted}`}>{location.active ? "Active" : "Inactive"}</span></div>) : <EmptyState title="No locations configured">Add a location before scheduling site-based sales.</EmptyState>}</Surface>{canManageAkuvox ? <Surface>{akuvoxData ? <ClubAkuvoxDeviceAdmin organisationId={context.organisation.id} location={akuvoxData.location} devices={akuvoxData.devices} durationSetting={durationSetting} /> : <EmptyState title="Akuvox device administration unavailable">The authorised device list could not be loaded. Retry the page; no device was provisioned.</EmptyState>}</Surface> : null}<BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to overview</BackButton><AppNav /></AppShell>;
  } catch { return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Locations" description="Location context." /><EmptyState title="Locations couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>; }
}
