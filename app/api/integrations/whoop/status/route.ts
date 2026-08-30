import { NextResponse } from "next/server";
import { config, getConnection } from "@/lib/whoop-server";
import { serverSupabase } from "@/lib/supabase-server";
export async function GET() { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); const connection = await getConnection(user.id); const admin = (await import("@/lib/whoop-server")).latestRecord(user.id); return NextResponse.json({ provider: "whoop", configured: Boolean(config().clientId && config().clientSecret && config().redirectUri), connected: Boolean(connection), lastSyncAt: connection?.last_sync_at, scopes: connection?.scopes ?? [], latest: await admin }); }
