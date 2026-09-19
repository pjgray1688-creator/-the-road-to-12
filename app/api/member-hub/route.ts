import { serverSupabase } from "@/lib/supabase-server";
import { privateJson } from "@/lib/private-response";

/** Minimal member-safe context for lightweight Today surfaces. */
export async function GET() {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return privateJson({ organisations: [] }, { status: 401 });
  const { data, error } = await client.rpc("club_list_my_memberships");
  if (error || !Array.isArray(data)) return privateJson({ organisations: [] });
  const organisations = data.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const organisation = (value as { organisation?: unknown }).organisation;
    if (!organisation || typeof organisation !== "object") return [];
    const record = organisation as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") return [];
    return [{ id: record.id, name: record.name, slug: typeof record.slug === "string" ? record.slug : undefined }];
  }).filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index);
  return privateJson({ organisations });
}
