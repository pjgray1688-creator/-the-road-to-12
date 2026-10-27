import { privateJson } from "@/lib/private-response";
import { resolveGlowZoneCustomerContext } from "@/lib/glow-zone-customer-context";
import { isGlowZoneReviewer } from "@/lib/glow-zone-reviewer";
import { serverSupabase } from "@/lib/supabase-server";

export async function GET() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  if (isGlowZoneReviewer(user)) return privateJson({ customerState: "ready", ageStatus: "required" });
  const context = await resolveGlowZoneCustomerContext(client, user.id);
  if (context.state === "unavailable") return privateJson({ customerState: "unavailable", ageStatus: "unavailable" }, { status: 503 });
  if (context.state === "unlinked") return privateJson({ customerState: "unlinked", ageStatus: "not_applicable" });
  const { data, error } = await client.from("club_glow_age_verifications")
    .select("status")
    .eq("organisation_id", context.organisation.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return privateJson({ customerState: "ready", ageStatus: "unavailable" }, { status: 503 });
  const ageStatus = context.declaredUnder18 ? "under_18" : data?.status === "verified" ? "verified" : data?.status === "under_18" ? "under_18" : "required";
  return privateJson({ customerState: "ready", ageStatus, details: context.details, missingDetails: context.missingDetails });
}
