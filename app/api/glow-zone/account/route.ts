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
  const { data, error } = await client.rpc("club_glow_my_customer_account_secure", { p_organisation_id: context.organisation.id });
  if (error) return privateJson({ customerState: "ready", ageStatus: "unavailable" }, { status: 503 });
  const account = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const ageStatus = account.age_status === "verified" ? "verified" : account.age_status === "under_18" ? "under_18" : "required";
  return privateJson({ customerState: "ready", ageStatus, details: context.details, missingDetails: context.missingDetails });
}
