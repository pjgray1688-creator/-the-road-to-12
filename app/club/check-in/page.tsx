import { redirect } from "next/navigation";
import { ClubCheckinStation } from "@/components/club-checkin-station";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

export default async function ClubCheckInPage({searchParams}:{searchParams?:Promise<{org?:string}>}) {
  const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();
  if(!user)redirect("/account?mode=signIn&next=%2Fclub%2Fcheck-in");
  const context=await resolveClubOrganisationContext(client,user.id,(await searchParams)?.org);
  if(!context||!(await context.repository.hasCapability(context.organisation.id,user.id,"members.view"))) redirect("/club");
  const locations=(await context.repository.listLocations(context.organisation.id)).filter(location=>location.active).map(({id,name})=>({id,name}));
  return <ClubCheckinStation organisationId={context.organisation.id} locations={locations} />;
}
