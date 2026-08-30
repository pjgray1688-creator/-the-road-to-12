import { NextResponse } from "next/server";
import { authorizationUrl, config, createState } from "@/lib/whoop-server";
import { serverSupabase } from "@/lib/supabase-server";
export async function GET() { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); if (!config().clientId) return NextResponse.json({ error: "WHOOP integration is not configured." }, { status: 503 }); const state = createState(); const response = NextResponse.redirect(authorizationUrl(state)!); response.cookies.set("whoop_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" }); return response; }
