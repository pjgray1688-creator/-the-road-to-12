import { privateJson } from "@/lib/private-response";
import { clearConnection } from "@/lib/whoop-server";
import { serverSupabase } from "@/lib/supabase-server";
export async function POST() { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 }); await clearConnection(user.id); return privateJson({ connected: false }); }
