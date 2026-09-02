import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { AppNav } from "@/components/app-nav";
import { AppShell, NavigationRow, Surface } from "@/components/ui";
import { madhouseFixture, clubRepository } from "@/lib/club-repository";
import { resolveOrganisationTheme } from "@/lib/club";

/** Club remains capability-gated until the reviewed migration is applied. */
export default async function ClubPage() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  let authorised = false; let organisationName = "R12 Club";
  if (process.env.NODE_ENV !== "production") { const repository = clubRepository(); const organisation = (await repository.listOrganisations()).find(item => item.id === madhouseFixture.id); if (organisation) { authorised = true; organisationName = resolveOrganisationTheme(organisation).organisationName; } }
  if (process.env.R12_CLUB_SCHEMA_ENABLED === "true") {
    const { data: member } = await supabase.from("club_members").select("role, organisation_id, club_organisations(name)").eq("user_id", user.id).eq("active", true).in("role", ["gym_staff", "gym_admin", "owner"]).maybeSingle();
    authorised = Boolean(member);
    const organisation = Array.isArray(member?.club_organisations) ? member.club_organisations[0] : member?.club_organisations;
    if (organisation && typeof organisation === "object" && "name" in organisation && typeof organisation.name === "string") organisationName = organisation.name;
  }
  if (!authorised) return <AppShell className="module-page club-page"><Surface><span className="eyebrow">R12 CLUB</span><h1>Club access</h1><p className="muted">Your account does not have club-management access yet.</p></Surface><AppNav /></AppShell>;
  return <AppShell className="module-page club-page"><header className="page-header"><div><p className="eyebrow">R12 CLUB</p><h1>{organisationName}</h1><p className="page-header-description">Manage your organisation and locations.</p></div></header><Surface><NavigationRow label="Members" detail="People connected to your organisation" /><NavigationRow label="Memberships" detail="Active packages and access" /><NavigationRow label="Packages" detail="Products and entitlements" /><NavigationRow label="Coaches" detail="Staff and client relationships" /><NavigationRow label="Locations" detail="Current and future sites" /><NavigationRow label="Access" detail="Eligibility and credentials" /></Surface><AppNav /></AppShell>;
}
