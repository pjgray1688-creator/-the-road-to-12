import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ provider: "whoop", status: "not_configured", required: ["WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "WHOOP_REDIRECT_URI"], scopes: ["offline", "read:recovery", "read:sleep", "read:workout", "read:cycles"] }); }
