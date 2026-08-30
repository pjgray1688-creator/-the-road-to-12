import { NextResponse } from "next/server";
import { clearConnection } from "@/lib/whoop-server";
import { serverSupabase } from "@/lib/supabase-server";
export async function POST() { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); await clearConnection(user.id); return NextResponse.json({ connected: false }); }
