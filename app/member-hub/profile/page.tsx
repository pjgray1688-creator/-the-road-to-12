import { redirect } from "next/navigation";
import { AppShell, PageHeader, Surface } from "@/components/ui";
import { MemberHomeGymForm } from "@/components/member-home-gym-form";
import { serverSupabase } from "@/lib/supabase-server";

export default async function MemberProfilePage() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub%2Fprofile");
  const { data: memberships } = await client.rpc("club_list_my_memberships");
  const rows = Array.isArray(memberships) ? memberships as Array<Record<string, unknown>> : [];
  const madhouse = rows.find(row => String((row.organisation as Record<string, unknown> | undefined)?.slug) === "madhouse-gym");
  if (!madhouse) return <AppShell className="module-page member-area-page"><PageHeader title="Profile"/><Surface><p>Your Madhouse member profile is not linked to this R12 account yet.</p></Surface></AppShell>;
  const organisation = madhouse.organisation as Record<string, unknown>;
  const organisationId = String(organisation.id);
  const [{ data: profileData }, { data: locationData }] = await Promise.all([
    client.rpc("club_get_member_operational_profile", { p_organisation_id: organisationId, p_user_id: user.id }),
    client.rpc("club_list_join_locations", { p_organisation_id: organisationId }),
  ]);
  const profile = profileData && typeof profileData === "object" ? profileData as Record<string, unknown> : {};
  const home = profile.home_location && typeof profile.home_location === "object" ? profile.home_location as Record<string, unknown> : undefined;
  const locations = (Array.isArray(locationData) ? locationData : []).map(value => {
    const item = value as Record<string, unknown>;
    return { id: String(item.id), name: String(item.name) };
  }).filter(item => /rotherham|carlton/i.test(item.name));
  return <AppShell className="module-page member-area-page"><PageHeader title="Profile" description="Manage your Madhouse home gym preference."/><Surface><span className="eyebrow">MADHOUSE GYM</span><h2>Home gym</h2><p className="muted">Choose the gym you usually use. This sets your member shop collection default and does not limit access to either Madhouse gym.</p><MemberHomeGymForm organisationId={organisationId} locations={locations} currentLocationId={typeof home?.id === "string" ? home.id : undefined}/></Surface></AppShell>;
}
