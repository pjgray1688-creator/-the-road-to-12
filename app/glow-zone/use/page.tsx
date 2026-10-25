import { isGlowZoneReviewer } from "@/lib/glow-zone-reviewer";
import { GlowZoneReviewerUse } from "@/components/glow-zone-reviewer-use";
import { redirect } from "next/navigation";
import { AppShell,PageHeader,Surface } from "@/components/ui";
import { GlowZoneNav } from "@/components/glow-zone-nav";
import { GlowZoneUseSunbed } from "@/components/glow-zone-use-sunbed";
import { getGlowBalanceAction } from "@/app/club/sunbeds/actions";
import { resolveGlowZoneCustomerContext } from "@/lib/glow-zone-customer-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function GlowZoneUsePage(){
 const client=await serverSupabase();const{data:{user}}=await client.auth.getUser();if(!user)redirect("/account?mode=signIn&next=%2Fglow-zone%2Fuse");
 if(isGlowZoneReviewer(user))return <GlowZoneReviewerUse/>;const context=await resolveGlowZoneCustomerContext(client,user.id);if(context.state!=="ready")redirect("/glow-zone");
 const balance=await getGlowBalanceAction({organisationId:context.organisation.id,userId:user.id});
 return <AppShell className="module-page glow-zone-page"><div className="glow-zone-atmosphere" aria-hidden="true"/><PageHeader eyebrow="GLOW ZONE · CARLTON" title="Use Sunbed" description="Choose your session, then let reception approve it."/>{balance.ok?<GlowZoneUseSunbed organisationId={context.organisation.id} balance={balance.balance.minutes}/>:<Surface><h2>Balance unavailable</h2><p className="muted">A session request cannot be created until your current minutes are confirmed.</p></Surface>}<GlowZoneNav current="use"/></AppShell>;
}
