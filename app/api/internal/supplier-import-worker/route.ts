import { NextRequest, NextResponse } from "next/server";
import { runQueuedSupplierImportWorker } from "@/lib/supplier-import-worker";
import { verifyInternalWorkerAuth } from "@/lib/internal-worker-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = verifyInternalWorkerAuth(request, [process.env.CRON_SECRET]);
  if (auth === "missing_configuration") return NextResponse.json({ error: "Supplier import worker authentication is not configured" }, { status: 503 });
  if (auth === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    console.info("[supplier-import] worker endpoint reached; authentication succeeded");
    const result = await runQueuedSupplierImportWorker();
    const failed = typeof result.failed === "number" ? result.failed : 0;
    const summary = { claimed: result.claimed, started: result.started, completed: result.completed, failed };
    return NextResponse.json(summary, { status: failed ? 500 : 200 });
  } catch (error) {
    console.error("[supplier-import] worker route failed", { code: (error as { code?: unknown } | null)?.code ?? "UNKNOWN" });
    return NextResponse.json({ error: "Supplier import worker failed; review protected server logs." }, { status: 500 });
  }
}
