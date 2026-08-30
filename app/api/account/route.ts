import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";
export async function GET() { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); return NextResponse.json({ id: user.id, email: user.email }); }
