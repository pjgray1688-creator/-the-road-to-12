import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { MemberHomeGymForm } from "@/components/member-home-gym-form";
import { serverSupabase } from "@/lib/supabase-server";
import { splitMemberProfileMemberships } from "@/lib/member-profile-view";
import styles from "./profile.module.css";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const statusLabel = (status: string) => ({ active: "Active", paused: "Paused", expired: "Expired", cancelled: "Cancelled", pending: "Pending" }[status] ?? "Status unavailable");
const localDate = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium" }).format(new Date(value));

export default async function MemberProfilePage() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub%2Fprofile");

  const { data: memberships } = await client.rpc("club_list_my_memberships");
  const rows = Array.isArray(memberships) ? memberships as Row[] : [];
  const madhouse = rows.find(row => text(object(row.organisation).slug) === "madhouse-gym");
  if (!madhouse) return <AppShell className={`module-page member-area-page ${styles.page}`}><PageHeader title="Your profile"/><Surface><EmptyState title="Madhouse profile not linked">Link your existing Madhouse membership to see your member details here.</EmptyState><Link className="member-hub-link" href="/member-hub/link"><strong>Link existing membership</strong></Link></Surface></AppShell>;

  const organisation = object(madhouse.organisation);
  const organisationId = text(organisation.id);
  const [{ data: profileData }, { data: locationData }] = await Promise.all([
    client.rpc("club_get_member_operational_profile", { p_organisation_id: organisationId, p_user_id: user.id }),
    client.rpc("club_list_join_locations", { p_organisation_id: organisationId }),
  ]);
  const profile = object(profileData);
  const customer = object(profile.customer);
  const home = object(profile.home_location);
  const displayName = text(customer.display_name) || [text(user.user_metadata?.first_name), text(user.user_metadata?.last_name)].filter(Boolean).join(" ") || text(user.user_metadata?.display_name) || "R12 member";
  const locations = (Array.isArray(locationData) ? locationData : []).map(value => {
    const item = object(value);
    return { id: text(item.id), name: text(item.name) };
  }).filter(item => /rotherham|carlton/i.test(item.name));
  const { current: activeMemberships, past: pastMemberships } = splitMemberProfileMemberships(profile.memberships);

  return <AppShell className={`module-page member-area-page ${styles.page}`}>
    <PageHeader eyebrow="MADHOUSE GYM" title="Your profile" description="Your member details and gym preferences." />

    <Surface className={styles.section}>
      <div className={styles.sectionHeading}><div><span className="eyebrow">PERSONAL DETAILS</span><h2>{displayName}</h2></div></div>
      <dl className={styles.details}>
        <div><dt>Email</dt><dd>{text(user.email) || "Not available"}</dd></div>
        {text(customer.phone) ? <div><dt>Phone</dt><dd>{text(customer.phone)}</dd></div> : null}
      </dl>
    </Surface>

    <Surface className={styles.section}>
      <div className={styles.sectionHeading}><div><span className="eyebrow">MEMBERSHIP</span><h2>Your membership</h2></div></div>
      {activeMemberships.length ? <div className={styles.memberships}>{activeMemberships.map(item => <article className={styles.membership} key={text(item.id)}>
        <div><strong>{text(item.product_name) || "Gym membership"}</strong><span className={item.status === "active" ? styles.active : styles.paused}>{statusLabel(text(item.status))}</span></div>
        <p>Started {text(item.starts_at) ? localDate(text(item.starts_at)) : "Date not recorded"}{text(item.ends_at) ? ` · Paid through ${localDate(text(item.ends_at))}` : " · No expiry recorded"}</p>
      </article>)}</div> : <p className={styles.muted}>No active membership is recorded. Contact Madhouse staff if you expected one.</p>}
      <Link className={styles.textLink} href={`/member-hub?org=${encodeURIComponent(organisationId)}`}>View membership and account activity <span aria-hidden="true">›</span></Link>
      {pastMemberships.length ? <details className={styles.history}><summary>Past memberships ({pastMemberships.length})</summary><div>{pastMemberships.map(item => <article key={text(item.id)}><strong>{text(item.product_name) || "Gym membership"}</strong><span>{statusLabel(text(item.status))}{text(item.starts_at) ? ` · Started ${localDate(text(item.starts_at))}` : ""}{text(item.ends_at) ? ` · Ended ${localDate(text(item.ends_at))}` : ""}</span></article>)}</div></details> : null}
    </Surface>

    <Surface className={styles.section}>
      <div className={styles.sectionHeading}><div><span className="eyebrow">GYM ACCESS</span><h2>Access and home gym</h2></div></div>
      <p className={styles.muted}>Your home gym sets your shop preference. It does not limit access to either Madhouse gym.</p>
      <MemberHomeGymForm organisationId={organisationId} locations={locations} currentLocationId={text(home.id) || undefined}/>
      <Link className={styles.accessLink} href={`/member-hub/access?org=${encodeURIComponent(organisationId)}`}><span><strong>Open Gym Access</strong><small>View your current PIN and QR pass when eligible</small></span><b aria-hidden="true">›</b></Link>
    </Surface>

    <Surface className={`${styles.section} ${styles.accountSection}`}>
      <div className={styles.sectionHeading}><div><span className="eyebrow">ACCOUNT SETTINGS</span><h2>Security and preferences</h2></div></div>
      <Link className={styles.textLink} href="/account">Edit personal details, password and account settings <span aria-hidden="true">›</span></Link>
    </Surface>
  </AppShell>;
}
