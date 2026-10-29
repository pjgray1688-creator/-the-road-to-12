import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { ClubJoiningForm } from "@/components/club-joining-form";
import { BrandLockup } from "@/components/brand-lockup";
import { listPayPalCheckoutReadyProductIds } from "@/lib/paypal-pay-in-3-server";
import styles from "./join.module.css";
import { membershipRuleSummary } from "@/lib/madhouse-catalogue";

export default async function GymJoinPage({ params, searchParams }: { params: Promise<{ clubSlug: string }>; searchParams?: Promise<{ billing?: string }> }) {
  const supabase = await serverSupabase(); const slug = (await params).clubSlug;
  const [{ data: orgs }, { data: { user } }] = await Promise.all([supabase.rpc("club_list_joinable_organisations"), supabase.auth.getUser()]);
  const org = (Array.isArray(orgs) ? orgs as Array<{ id: string; name: string; slug: string }> : []).find(item => item.slug === slug);
  if (!org) notFound();
  const [{ data: productData }, { data: locationData }, stateResult] = await Promise.all([
    supabase.rpc("club_list_joinable_memberships", { p_organisation_id: org.id }),
    supabase.rpc("club_list_join_locations", { p_organisation_id: org.id }),
    user ? supabase.rpc("club_get_my_join_state", { p_organisation_id: org.id }) : Promise.resolve({ data: null }),
  ]);
  const productRows = (Array.isArray(productData) ? productData : []).map(value => { const item = value as Record<string, unknown>; const name = String(item.name); return { id: String(item.id), name, priceMinor: Number(item.price_minor), joiningFeeMinor: Number(item.joining_fee_minor ?? 0), joiningFeeConfigured: item.joining_fee_configured !== false, checkoutKind: String(item.checkout_kind ?? "one_off"), billing: String(item.billing), terms: membershipRuleSummary(name), ...(item.duration_days != null ? { durationDays: Number(item.duration_days) } : {}) }; });
  const paypalReadyIds = await listPayPalCheckoutReadyProductIds(org.id, productRows.map(product => product.id));
  const products = productRows.map(product => ({ ...product, paypalCheckoutAvailable: paypalReadyIds.has(product.id) }));
  const locations = (Array.isArray(locationData) ? locationData : []).map(value => ({ id: String(value.id), name: String(value.name) }));
  const returnTo = `/join/${encodeURIComponent(org.slug)}`;
  const billing = (await searchParams)?.billing;
  const paymentNotice = billing === "paypal-cancelled"
    ? "PayPal checkout was closed. If you approved a payment, it will appear here only after verified confirmation."
    : billing === "paypal-pending"
      ? "PayPal is still confirming the payment. Membership access stays inactive until confirmation is received."
      : undefined;
  return <AppShell className={`module-page ${styles.joinPage}`}><div className={styles.brand}><BrandLockup compact/><span><strong>R12 × MADHOUSE</strong><small>ROTHERHAM · CARLTON</small></span></div><PageHeader eyebrow="MADHOUSE MEMBERSHIP" title={`Join ${org.name}`} description="Choose the membership that suits you. Your R12 account keeps everything together, on any device." />
    {org.slug === "madhouse-gym" ? <Surface className={styles.choiceSurface}><span className="eyebrow">SHARED MEMBERSHIP</span><h2>Family Membership</h2><p>Contact us for pricing and details. Family memberships are arranged directly with Madhouse and are not available for automatic online checkout.</p></Surface> : null}
    {!user ? <Surface className={styles.choiceSurface}><h2>How would you like to continue?</h2><p className={styles.choiceIntro}>New to Madhouse? Start your membership below. Already a member? Link your existing membership to R12.</p><div className={styles.actions}><Link className={`${styles.action} ${styles.actionPrimary}`} href={`/account?mode=signUp&next=${encodeURIComponent(returnTo)}`}><strong>Join Madhouse</strong><small>Create your personal R12 account</small><span aria-hidden="true">›</span></Link><Link className={styles.action} href={`/account?mode=signIn&next=${encodeURIComponent("/member-hub/link")}`}><strong>Already a member</strong><small>Activate your existing membership</small><span aria-hidden="true">›</span></Link><Link className={styles.signIn} href={`/account?mode=signIn&next=${encodeURIComponent(returnTo)}`}>Sign in to continue an application <span aria-hidden="true">→</span></Link></div><p className={styles.catalogueNote}>Membership options and prices are provided by Madhouse.</p></Surface>
      : !user.email_confirmed_at ? <Surface className={styles.choiceSurface}><h2>Verify your email</h2><p>Open the confirmation email from R12, then return here. Membership cannot be linked or activated until your account email is verified.</p><Link className={styles.signIn} href="/account">Account help <span aria-hidden="true">→</span></Link></Surface>
      : <ClubJoiningForm organisationId={org.id} products={products} locations={locations} accountEmail={user.email ?? ""} initialState={(stateResult.data ?? null) as never} paymentNotice={paymentNotice} />}
  </AppShell>;
}
