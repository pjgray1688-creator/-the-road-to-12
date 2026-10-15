import { redirect } from "next/navigation";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubPinSettings } from "@/components/club-pin-settings";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
export const metadata={title:"Account · R12 Club"};
export default async function ClubAccountPage({searchParams}:{searchParams?:Promise<{org?:string}>}){
 const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();if(!user)redirect("/account?mode=signIn&next=%2Fclub%2Faccount");const context=await resolveClubOperationalContext(client,user.id,(await searchParams)?.org);
 if(!context)return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · ACCOUNT" title="Account"/><EmptyState title="Club staff access required">Sign in with an active Club staff account.</EmptyState></AppShell>;
 const profile=await client.from("profiles").select("first_name,last_name,display_name").eq("id",user.id).maybeSingle();const name=[profile.data?.first_name,profile.data?.last_name].filter(Boolean).join(" ")||profile.data?.display_name||user.email||"Club staff";
 return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · ACCOUNT" title="Your Club account" description="Your personal R12 identity and shared-station access."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><Surface><span className="eyebrow">SIGNED-IN IDENTITY</span><h2>{name}</h2><p>{user.email}</p><p className="muted">Club access: active as {context.role==="gym_admin"?"Manager":context.role==="gym_staff"?"Operational Staff":context.role==="trainer"?"PT / Coach":"Owner"}.</p><p className="muted">Sign out from the identity menu at the top of Club.</p></Surface><Surface><ClubPinSettings organisationId={context.organisation.id}/></Surface></AppShell>;
}
