import type { SupabaseClient } from "@supabase/supabase-js";
import { GLOW_ZONE_ORGANISATION_ID } from "@/lib/glow-zone";
type GlowOrganisation={id:string;name:string;slug:string;active:true};type MembershipBoundaryRow={organisation?:{id?:string};membership?:{status?:string}};
/** Resolves an existing linked customer without creating membership, entitlement or access. */
export async function resolveGlowZoneCustomerContext(client:SupabaseClient,userId:string){
  const [serviceResult,customerResult,membershipResult]=await Promise.all([
    client.from("club_location_service_hours").select("organisation_id").eq("organisation_id",GLOW_ZONE_ORGANISATION_ID).eq("location_name","Carlton").eq("service_key","sunbeds"),
    client.from("club_customers").select("id,organisation_id,status").eq("organisation_id",GLOW_ZONE_ORGANISATION_ID).eq("user_id",userId),
    client.rpc("club_list_my_memberships"),
  ]);
  if(serviceResult.error||customerResult.error)return{state:"unavailable" as const};
  const organisationIds=[...new Set((serviceResult.data??[]).map(value=>String(value.organisation_id)))];
  if(organisationIds.length!==1||organisationIds[0]!==GLOW_ZONE_ORGANISATION_ID)return{state:"unavailable" as const};
  const target:GlowOrganisation={id:GLOW_ZONE_ORGANISATION_ID,name:"Madhouse Gym Carlton",slug:"madhouse-gym",active:true};
  const customer=(customerResult.data??[]).find(value=>String(value.organisation_id)===target.id);
  if(!customer)return{state:"unlinked" as const,organisation:target};
  const membershipPricingAvailable=!membershipResult.error;
  const activeGymMembership=membershipPricingAvailable&&(Array.isArray(membershipResult.data)?membershipResult.data:[]).some(value=>{const row=value as MembershipBoundaryRow;return row.organisation?.id===target.id&&row.membership?.status==="active";});
  return{state:"ready" as const,organisation:target,customerId:String(customer.id),activeGymMembership,membershipPricingAvailable};
}
