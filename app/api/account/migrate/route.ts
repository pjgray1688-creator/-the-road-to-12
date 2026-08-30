import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";
import { prepareOwnerMigration } from "@/lib/migration";
export async function POST(request: NextRequest) { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); const data = await request.json(); return NextResponse.json(prepareOwnerMigration(data, user.id)); }
