import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { AppNav } from "@/components/app-nav";
import { AppShell, NavigationRow, Surface } from "@/components/ui";
import { clubRepository } from "@/lib/club-repository";
import { resolveOrganisationTheme } from "@/lib/club";

/** Club remains explicitly capability-gated even though its schema is installed. */
export default async function ClubPage() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  let repository; try { repository = clubRepository(supabase); } catch { repository = undefined; }
  if (!repository) return <AppShell className="module-page club-page"><Surface><span className="eyebrow">R12 CLUB</span><h1>Club access</h1><p className="muted">Your account does not have club-management access yet.</p></Surface><AppNav /></AppShell>;
  const organisations = await repository.listOrganisations(); let selectedOrganisation: (typeof organisations)[number] | undefined = organisations[0]; let members = [] as Awaited<ReturnType<typeof repository.listMembers>>;
  if (process.env.NODE_ENV === "production") { const memberSets = await Promise.all(organisations.map(organisation => repository.listMembers(organisation.id))); const organisationIndex = memberSets.findIndex(items => items.some(member => member.userId === user.id && ["gym_staff", "gym_admin", "owner"].includes(member.role))); selectedOrganisation = organisationIndex >= 0 ? organisations[organisationIndex] : undefined; members = organisationIndex >= 0 ? memberSets[organisationIndex] : []; } else if (selectedOrganisation) members = await repository.listMembers(selectedOrganisation.id);
  const authorised = Boolean(selectedOrganisation); const organisationName = resolveOrganisationTheme(selectedOrganisation).organisationName;
  if (!authorised) return <AppShell className="module-page club-page"><Surface><span className="eyebrow">R12 CLUB</span><h1>Club access</h1><p className="muted">Your account does not have club-management access yet.</p></Surface><AppNav /></AppShell>;
  const [products, locations] = await Promise.all([repository.listProducts(selectedOrganisation!.id), repository.listLocations(selectedOrganisation!.id)]);
  return <AppShell className="module-page club-page"><header className="page-header"><div><p className="eyebrow">R12 CLUB</p><h1>{organisationName}</h1><p className="page-header-description">{process.env.NODE_ENV === "production" ? "Organisation workspace" : "Local fixture workspace"}</p></div></header><Surface><span className="eyebrow">OVERVIEW</span><NavigationRow label="Members" detail={`${members.length} organisation members`} /><NavigationRow label="Memberships" detail="Assignments are available through the repository" /><NavigationRow label="Products" detail={`${products.length} configured products`} /><NavigationRow label="Locations" detail={`${locations.length} configured locations`} /></Surface><Surface><span className="eyebrow">LOCATIONS</span>{locations.map(location => <NavigationRow key={location.id} label={location.name} detail={location.active ? "Active location" : "Inactive location"} />)}</Surface><Surface><span className="eyebrow">PRODUCTS</span>{products.map(product => <NavigationRow key={product.id} label={product.name} detail={`£${(product.priceMinor / 100).toFixed(2)} · ${product.sellable ? "Sellable" : "Archived"}`} />)}</Surface><AppNav /></AppShell>;
}
