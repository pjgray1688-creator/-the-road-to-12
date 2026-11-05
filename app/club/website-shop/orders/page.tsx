import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubMadhouseApparelOrders, type ClubApparelOrder } from "@/components/club-madhouse-apparel-orders";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

const ORG="fa44592a-1593-4ad3-a621-63a4a4bcbceb";
export const dynamic="force-dynamic";

export default async function MadhouseApparelOrdersPage({searchParams}:{searchParams?:Promise<{org?:string;order?:string}>}){
  const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();if(!user)redirect("/account?app=club&mode=signIn");
  const params=await searchParams;const context=await resolveClubOrganisationContext(client,user.id,params?.org);
  if(!context||context.organisation.id!==ORG||!(await context.repository.hasCapability(ORG,user.id,"commerce.pricing_manage")))return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Website Shop · Orders"/><EmptyState title="Management access required">Madhouse Apparel customer orders are available to authorised commerce managers.</EmptyState><AppNav/></AppShell>;
  const {data,error}=await client.rpc("club_list_madhouse_apparel_orders",{p_organisation_id:ORG});
  const orders=error?[]:(Array.isArray(data)?data:[]) as ClubApparelOrder[];
  const query=`?org=${encodeURIComponent(ORG)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · MADHOUSE APPAREL" title="Website Shop · Orders" description="Made-to-order customer orders, payment state and fulfilment."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    {error?<EmptyState title="Orders are not available yet">The Website Apparel orders database migration must be deployed before the order list can load.</EmptyState>:<ClubMadhouseApparelOrders organisationId={ORG} orders={orders} initialOrderId={params?.order}/>}
    <a className="text-button" href={`/club/website-shop${query}`}>Products &amp; Pricing</a><AppNav/></AppShell>;
}
