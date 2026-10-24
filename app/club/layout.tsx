import type { Metadata } from "next";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { ClubIdentityControl } from "@/components/club-identity-control";
import { ClubStationTimeout } from "@/components/club-station-lock";
import { cookies } from "next/headers";
import { CLUB_STATION_COOKIE, stationCookieValue, stationSessionTtlSeconds } from "@/lib/club-station";
import { headers } from "next/headers";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (hasPlayReviewerEntitlement(user)) return { title: "R12 Club · App Review Demo", description: "Read-only synthetic Club demonstration.", manifest: "/club/manifest.webmanifest" };
    const context = user ? await resolveClubOperationalContext(supabase, user.id) : undefined;
    return { title: context?.organisation.name ? `R12 Club · ${context.organisation.name}` : "R12 Club", description: "Operational tools for R12 clubs.", manifest: "/club/manifest.webmanifest" };
  } catch {
    return { title: "R12 Club", description: "Operational tools for R12 clubs.", manifest: "/club/manifest.webmanifest" };
  }
}

export default async function ClubLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();const cookieStore=await cookies();const station=stationCookieValue(cookieStore.get(CLUB_STATION_COOKIE)?.value);
  const reviewer=hasPlayReviewerEntitlement(user);
  const profile=user&&!reviewer?await client.from("profiles").select("first_name,last_name,display_name").eq("id",user.id).maybeSingle():{data:null};
  const lockRoute=(await headers()).get("x-r12-club-lock-route")==="1";
  const firstName=reviewer?"App Review Demoer":profile.data?.first_name||user?.user_metadata?.first_name||user?.email?.split("@")[0]||"Staff";
  const fullName=reviewer?"App Review Demoer":[profile.data?.first_name,profile.data?.last_name].filter(Boolean).join(" ")||profile.data?.display_name||user?.user_metadata?.display_name||firstName;
  return <>{user&&!(station&&lockRoute)?<ClubIdentityControl firstName={firstName} fullName={fullName} photoUrl={typeof user.user_metadata?.avatar_url==="string"?user.user_metadata.avatar_url:undefined}/>:null}<ClubStationTimeout enabled={Boolean(station&&user&&!lockRoute)} timeoutMinutes={stationSessionTtlSeconds()/60}/>{children}</>;
}
