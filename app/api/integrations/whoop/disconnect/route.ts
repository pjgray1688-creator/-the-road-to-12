import { NextResponse } from "next/server";
import { clearToken } from "@/lib/whoop-server";
export async function POST() { clearToken(); return NextResponse.json({ connected: false }); }
