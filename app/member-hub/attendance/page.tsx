import { redirect } from "next/navigation";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { clubRepository } from "@/lib/club-repository";
import { serverSupabase } from "@/lib/supabase-server";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { MemberDemoNotice } from "@/components/member-demo-notice";

export default async function MemberAttendancePage({searchParams}:{searchParams?:Promise<{org?:string;location?:string}>}) {
  const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();if(!user)redirect("/account?mode=signIn&next=%2Fmember-hub%2Fattendance");
  if(hasPlayReviewerEntitlement(user))return <AppShell className="module-page member-area-page"><PageHeader eyebrow="R12 CLUB" title="Monthly attendance" description="Visits this calendar month, counted at the venue where you checked in."/><MemberDemoNotice/><Surface><nav className="toolbar-actions" aria-label="Demo venue filter"><span className="primary">All gyms · demo</span><span className="secondary">Rotherham · demo</span><span className="secondary">Carlton · demo</span></nav><ol className="club-attendance-leaderboard"><li><span className="club-attendance-rank">1</span><strong>Sample Member · demo</strong><span>6 example visits</span></li></ol><p className="muted">Illustrative ranking only. No member attendance records are shown.</p></Surface></AppShell>;
  const params=await searchParams;const {data:memberships}=await client.rpc("club_list_my_memberships");
  const rows=Array.isArray(memberships)?memberships as Array<Record<string,unknown>>:[];
  const row=rows.find(value=>String((value.organisation as Record<string,unknown>|undefined)?.id)===params?.org)??rows[0];
  if(!row)return <AppShell className="module-page member-area-page"><PageHeader title="Attendance"/><EmptyState title="Connect your gym first">The attendance leaderboard is available once your Club membership is linked.</EmptyState></AppShell>;
  const org=row.organisation as Record<string,unknown>;const organisationId=String(org.id);const repository=clubRepository(client);const locations=(await repository.listLocations(organisationId)).filter(item=>item.active);
  const locationId=locations.some(item=>item.id===params?.location)?params?.location:undefined;
  const {data,error}=await client.rpc("club_monthly_attendance_leaderboard",{p_organisation_id:organisationId,p_location_id:locationId??null});
  const leaderboard=!error&&Array.isArray(data)?data as Array<{rank:number;displayName:string;visits:number}>:[];
  return <AppShell className="module-page member-area-page"><PageHeader eyebrow="R12 CLUB" title="Monthly attendance" description="Visits this calendar month, counted at the venue where you checked in."/><Surface>
    <nav className="toolbar-actions" aria-label="Filter attendance by venue"><a className={!locationId?"primary":"secondary"} href={`/member-hub/attendance?org=${encodeURIComponent(organisationId)}`}>All gyms</a>{locations.map(location=><a className={location.id===locationId?"primary":"secondary"} key={location.id} href={`/member-hub/attendance?org=${encodeURIComponent(organisationId)}&location=${encodeURIComponent(location.id)}`}>{location.name}</a>)}</nav>
    {error?<p role="status" className="muted">Attendance is temporarily unavailable.</p>:leaderboard.length?<ol className="club-attendance-leaderboard">{leaderboard.map((entry,index)=><li key={`${entry.rank}-${index}`}><span className="club-attendance-rank">{entry.rank}</span><strong>{entry.displayName}</strong><span>{entry.visits} {entry.visits===1?"visit":"visits"}</span></li>)}</ol>:<p className="muted">No recorded visits yet this month.</p>}
  </Surface></AppShell>;
}
