import { NextRequest, NextResponse } from "next/server";
import { runQueuedSupplierImportWorker } from "@/lib/supplier-import-worker";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    console.info("[supplier-import] worker endpoint reached; authentication succeeded");
    return NextResponse.json(await runQueuedSupplierImportWorker());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Worker execution failed" }, { status: 500 });
  }
}
