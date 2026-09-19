import { privateJson } from "@/lib/private-response";
import { config, getConnection } from "@/lib/whoop-server";
import { serverSupabase } from "@/lib/supabase-server";
export async function GET() { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 }); const connection = await getConnection(user.id); const admin = (await import("@/lib/whoop-server")).latestRecord(user.id); return privateJson({ provider: "whoop", configured: Boolean(config().clientId && config().clientSecret && config().redirectUri), connected: Boolean(connection), lastSyncAt: connection?.last_sync_at, scopes: connection?.scopes ?? [], latest: await admin }); }
