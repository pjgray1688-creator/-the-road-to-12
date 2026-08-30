import { NextResponse } from "next/server";
import { connectionStatus, config } from "@/lib/whoop-server";
export async function GET() { return NextResponse.json({ provider: "whoop", configured: Boolean(config().clientId && config().clientSecret && config().redirectUri), ...connectionStatus() }); }
