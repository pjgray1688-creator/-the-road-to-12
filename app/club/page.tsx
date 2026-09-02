import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { AppNav } from "@/components/app-nav";
import { AppShell, NavigationRow, Surface } from "@/components/ui";
import { madhouseFixture, memoryClubRepository } from "@/lib/club-repository";
import { resolveOrganisationTheme } from "@/lib/club";

/** Club remains capability-gated until the reviewed migration is applied. */
export default async function ClubPage() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  let authorised = false; let organisationName = "R12 Club";
  const localRepository = process.env.NODE_ENV !== "production" ? memoryClubRepository() : undefined;
  if (localRepository) { const organisation = (await localRepository.listOrganisations()).find(item => item.id === madhouseFixture.id); if (organisation) { authorised = true; organisationName = resolveOrganisationTheme(organisation).organisationName; } }
  if (process.env.R12_CLUB_SCHEMA_ENABLED === "true") {
    const { data: member } = await supabase.from("club_members").select("role, organisation_id, club_organisations(name)").eq("user_id", user.id).eq("active", true).in("role", ["gym_staff", "gym_admin", "owner"]).maybeSingle();
    authorised = Boolean(member);
    const organisation = Array.isArray(member?.club_organisations) ? member.club_organisations[0] : member?.club_organisations;
    if (organisation && typeof organisation === "object" && "name" in organisation && typeof organisation.name === "string") organisationName = organisation.name;
  }
  if (!authorised) return <AppShell className="module-page club-page"><Surface><span className="eyebrow">R12 CLUB</span><h1>Club access</h1><p className="muted">Your account does not have club-management access yet.</p></Surface><AppNav /></AppShell>;
  const products = localRepository ? await localRepository.listProducts(madhouseFixture.id) : []; const locations = localRepository ? await localRepository.listLocations(madhouseFixture.id) : [];
  return <AppShell className="module-page club-page"><header className="page-header"><div><p className="eyebrow">R12 CLUB</p><h1>{organisationName}</h1><p className="page-header-description">Local fixture workspace · production data remains disabled.</p></div></header><Surface><span className="eyebrow">OVERVIEW</span><NavigationRow label="Members" detail="No fixture members created" /><NavigationRow label="Memberships" detail="Assignments are available through the repository" /><NavigationRow label="Products" detail={`${products.length} Madhouse fixture products`} /><NavigationRow label="Locations" detail={`${locations.length} configured locations`} /></Surface><Surface><span className="eyebrow">LOCATIONS</span>{locations.map(location => <NavigationRow key={location.id} label={location.name} detail={location.active ? "Active location" : "Inactive location"} />)}</Surface><Surface><span className="eyebrow">PRODUCTS</span>{products.map(product => <NavigationRow key={product.id} label={product.name} detail={`£${(product.priceMinor / 100).toFixed(2)} · ${product.sellable ? "Sellable" : "Archived"}`} />)}</Surface><AppNav /></AppShell>;
}
