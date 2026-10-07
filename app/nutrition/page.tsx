import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { NutritionMember } from "@/components/nutrition-member";

export default async function NutritionPage() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fnutrition");
  const { data, error } = await client.rpc("nutrition_get_member_view");
  return <NutritionMember initialData={error ? { plan: null, checkins: [], feedback: [] } : (data ?? { plan: null, checkins: [], feedback: [] })} />;
}
