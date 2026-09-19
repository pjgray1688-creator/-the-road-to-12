import { NextResponse } from "next/server";
import { privateJson } from "@/lib/private-response";
import { authorizationUrl, config, createState } from "@/lib/whoop-server";
import { serverSupabase } from "@/lib/supabase-server";
export async function GET() { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 }); if (!config().clientId) return privateJson({ error: "WHOOP integration is not configured." }, { status: 503 }); const state = createState(); const response = NextResponse.redirect(authorizationUrl(state)!); response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate"); response.headers.set("Vary", "Cookie"); response.cookies.set("whoop_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" }); return response; }
