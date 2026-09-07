import Link from "next/link";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";

export default async function JoinPage() { const supabase = await serverSupabase(); const { data } = await supabase.rpc("club_list_joinable_organisations"); const organisations = Array.isArray(data) ? data as Array<{ id: string; name: string; slug: string }> : []; return <AppShell className="module-page"><PageHeader eyebrow="MEMBER HUB" title="Join a gym" description="Choose an onboarded gym to continue." />{organisations.length ? <Surface><div className="quick-grid">{organisations.map(org => <Link key={org.id} href={`/join/${encodeURIComponent(org.slug)}`}><strong>{org.name}</strong><small>View membership options</small></Link>)}</div></Surface> : <EmptyState title="Joining is not available yet">Ask your gym for an R12 join link.</EmptyState>}</AppShell>; }
