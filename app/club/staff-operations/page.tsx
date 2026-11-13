import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

type Destination = { title: string; description: string; href: string };

export default async function StaffOperationsPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn&next=%2Fclub%2Fstaff-operations");

  const params = await searchParams;
  const context = await resolveClubOperationalContext(client, user.id, params?.org);
  if (!context) return <AppShell className="module-page club-page"><PageHeader title="Staff Operations" /><EmptyState title="Staff access required">This workspace is available to active Club staff only.</EmptyState><AppNav /></AppShell>;

  const org = encodeURIComponent(context.organisation.id);
  const location = params?.location ? `&location=${encodeURIComponent(params.location)}` : "";
  const destinations: Destination[] = [
    ...(context.navigation.dailyChecks ? [{ title: "Daily Checks", description: "Complete authorised venue checks and report faults.", href: `/club/checks?org=${org}${location}` }] : []),
    { title: "My Shift", description: "View and submit your shift work.", href: `/club/work?org=${org}${location}` },
    { title: "My Rota", description: "View your assigned shifts and venues.", href: `/club/schedule?org=${org}&view=mine${location}` },
    ...(context.navigation.induction ? [{ title: "Inductions", description: "Record authorised member inductions.", href: `/club/induction?org=${org}${location}` }] : []),
  ];

  return <AppShell className="module-page club-page">
    <PageHeader title="Staff Operations" />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <Surface>
      <div className="club-management-links">
        {destinations.map(item => <Link key={item.title} href={item.href}><span><strong>{item.title}</strong><small>{item.description}</small></span><span aria-hidden="true">›</span></Link>)}
      </div>
    </Surface>
    <AppNav />
  </AppShell>;
}
