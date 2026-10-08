"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";

export async function markScheduleNotificationSeenAction(organisationId:string,notificationId:string){
 const supabase=await serverSupabase();const {data:{user}}=await supabase.auth.getUser();if(!user)return;
 await supabase.rpc("club_mark_my_schedule_notification_seen",{p_organisation_id:organisationId,p_notification_id:notificationId});
 revalidatePath("/member-hub/schedule");revalidatePath("/member-hub");
}
