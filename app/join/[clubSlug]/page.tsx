import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { ClubJoiningForm } from "@/components/club-joining-form";

export default async function GymJoinPage({ params }: { params: Promise<{ clubSlug: string }> }) {
  const supabase = await serverSupabase(); const slug = (await params).clubSlug;
  const [{ data: orgs }, { data: { user } }] = await Promise.all([supabase.rpc("club_list_joinable_organisations"), supabase.auth.getUser()]);
  const org = (Array.isArray(orgs) ? orgs as Array<{ id: string; name: string; slug: string }> : []).find(item => item.slug === slug);
  if (!org) notFound();
  const [{ data: productData }, { data: locationData }, stateResult] = await Promise.all([
    supabase.rpc("club_list_joinable_memberships", { p_organisation_id: org.id }),
    supabase.rpc("club_list_join_locations", { p_organisation_id: org.id }),
    user ? supabase.rpc("club_get_my_join_state", { p_organisation_id: org.id }) : Promise.resolve({ data: null }),
  ]);
  const products = (Array.isArray(productData) ? productData : []).map(value => { const item = value as Record<string, unknown>; return { id: String(item.id), name: String(item.name), priceMinor: Number(item.price_minor), billing: String(item.billing), ...(item.duration_days != null ? { durationDays: Number(item.duration_days) } : {}) }; });
  const locations = (Array.isArray(locationData) ? locationData : []).map(value => ({ id: String(value.id), name: String(value.name) }));
  const returnTo = `/join/${encodeURIComponent(org.slug)}`;
  return <AppShell className="module-page join-page"><PageHeader eyebrow="MADHOUSE MEMBERSHIP" title={`Join ${org.name}`} description="Join in your browser, then use the same personal R12 account on any device." />
    {!user ? <Surface><h2>How would you like to continue?</h2><div className="quick-grid"><Link className="primary" href={`/account?mode=signUp&next=${encodeURIComponent(returnTo)}`}><strong>Join Madhouse</strong><small>Create your personal R12 account</small></Link><Link href={`/account?mode=signIn&next=${encodeURIComponent("/member-hub/link")}`}><strong>I’m already a member</strong><small>Activate your existing Madhouse membership</small></Link><Link href={`/account?mode=signIn&next=${encodeURIComponent(returnTo)}`}><strong>Sign in</strong><small>Resume an existing application</small></Link></div><p className="muted">Membership options come directly from the current Madhouse catalogue. Your browser is fully supported.</p></Surface>
      : !user.email_confirmed_at ? <Surface><h2>Verify your email</h2><p>Open the confirmation email from R12, then return here. Membership cannot be linked or activated until the account email is verified.</p><Link href="/account">Account help</Link></Surface>
      : <ClubJoiningForm organisationId={org.id} products={products} locations={locations} accountEmail={user.email ?? ""} initialState={(stateResult.data ?? null) as never} />}
  </AppShell>;
}
