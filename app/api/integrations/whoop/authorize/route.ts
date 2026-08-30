import { NextResponse } from "next/server";
import { authorizationUrl, config, createState } from "@/lib/whoop-server";
export async function GET() { if (!config().clientId) return NextResponse.json({ error: "WHOOP integration is not configured." }, { status: 503 }); const state = createState(); const response = NextResponse.redirect(authorizationUrl(state)!); response.cookies.set("whoop_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" }); return response; }
