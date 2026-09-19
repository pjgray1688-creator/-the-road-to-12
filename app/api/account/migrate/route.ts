import { NextRequest } from "next/server";
import { privateJson } from "@/lib/private-response";
import { serverSupabase } from "@/lib/supabase-server";
import { prepareOwnerMigration } from "@/lib/migration";
export async function POST(request: NextRequest) { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 }); const data = await request.json(); return privateJson(prepareOwnerMigration(data, user.id)); }
