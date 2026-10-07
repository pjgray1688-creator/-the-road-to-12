import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function GET(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  if (url.searchParams.get("contexts") === "1") {
    const { data, error } = await client.rpc("coach_list_member_search_contexts");
    if (error) return privateJson({ error: "Member search is unavailable" }, { status: error.code === "42501" ? 403 : 503 });
    return privateJson({ contexts: Array.isArray(data) ? data : [] });
  }
  const organisationId = url.searchParams.get("organisationId");
  const query = url.searchParams.get("query") ?? "";
  if (!organisationId || query.trim().length < 2) return privateJson({ members: [] });
  const { data, error } = await client.rpc("coach_search_club_members", { p_organisation_id: organisationId, p_query: query });
  if (error) return privateJson({ error: error.code === "42501" ? "You cannot search members at that venue." : "Member search is temporarily unavailable." }, { status: error.code === "42501" ? 403 : 503 });
  return privateJson({ members: Array.isArray(data) ? data : [] });
}
