"use server";

import { revalidatePath } from "next/cache";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
const ORG="fa44592a-1593-4ad3-a621-63a4a4bcbceb";

export async function updateMadhouseApparelOrder(input:{organisationId:string;orderId:string;status:string;courier?:string;trackingNumber?:string;trackingUrl?:string}){
  if(input.organisationId!==ORG||!/^[0-9a-f-]{36}$/i.test(input.orderId)||!["in_production","ready_to_dispatch","dispatched","delivered","cancelled","refunded"].includes(input.status))return{ok:false as const,error:"Check the order update."};
  const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();if(!user)return{ok:false as const,error:"Sign in with an authorised Club account."};
  const context=await resolveClubOrganisationContext(client,user.id,input.organisationId);if(!context||!(await context.repository.hasCapability(input.organisationId,user.id,"commerce.pricing_manage")))return{ok:false as const,error:"You do not have permission to update Apparel orders."};
  const {error}=await client.rpc("club_update_madhouse_apparel_fulfilment",{p_organisation_id:input.organisationId,p_order_id:input.orderId,p_status:input.status,p_courier:input.courier??null,p_tracking_number:input.trackingNumber??null,p_tracking_url:input.trackingUrl??null});
  if(error)return{ok:false as const,error:"The order could not be updated. Check the tracking details and try again."};
  revalidatePath("/club/website-shop/orders");return{ok:true as const};
}
