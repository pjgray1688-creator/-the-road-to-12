import { createClient } from "@supabase/supabase-js";

function workerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase worker configuration is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function log(client: ReturnType<typeof workerClient>, jobIds: string[], message: string, metadata: Record<string, unknown> = {}) {
  if (!jobIds.length) return;
  await client.from("club_import_job_logs").insert(jobIds.map(job_id => ({ job_id, level: "info", message, metadata }))).then(() => undefined, () => undefined);
}

function completionError(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Worker returned an invalid payload";
  const value = payload as Record<string, unknown>;
  if (value.status !== "completed") return `Worker returned non-terminal status: ${String(value.status ?? "undefined")}`;
  if (typeof value.jobId !== "string" || !("summary" in value)) return "Worker completion payload is missing expected fields";
  return undefined;
}

export async function runQueuedSupplierImportWorker(triggerJobId?: string) {
  const workerStartedAt = Date.now();
  let operation = "worker entry";
  const checkpoint = async (client: ReturnType<typeof workerClient>, message: string, metadata: Record<string, unknown> = {}) => {
    console.info(`[supplier-import] ${message}`, { elapsedMs: Date.now() - workerStartedAt, ...metadata });
    if (triggerJobId) await log(client, [triggerJobId], message, { elapsedMs: Date.now() - workerStartedAt, ...metadata });
  };
  try {
    console.info("[supplier-import] shared worker runner entered", { triggerJobId });
    const client = workerClient();
    console.info("[supplier-import] service-role client created", { triggerJobId });
    if (triggerJobId) await checkpoint(client, "after() callback executed");
    if (triggerJobId) await checkpoint(client, "job successfully queued");
    operation = "club_run_supplier_import_job invocation";
    const { data: claimed, error: claimError } = await client.rpc("club_claim_supplier_import_jobs", { p_limit: 1 });
    if (claimError) throw claimError;
    if (triggerJobId) await log(client, [triggerJobId], "club_claim_supplier_import_jobs executed");
    const ids = Array.isArray(claimed) ? claimed.filter((id): id is string => typeof id === "string") : claimed == null ? [] : [String(claimed)];
    console.info("[supplier-import] jobs claimed", { count: ids.length, jobIds: ids });
    if (triggerJobId) await log(client, [triggerJobId], "number of claimed jobs", { count: ids.length });
    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      await log(client, [id], "job status changed to running");
      await log(client, [id], "club_run_supplier_import_job invoked");
      await checkpoint(client, "before club_run_supplier_import_job RPC", { jobId: id });
      const { data, error } = await client.rpc("club_run_supplier_import_job", { p_job_id: id });
      await checkpoint(client, "after club_run_supplier_import_job RPC response", { jobId: id, hasError: Boolean(error) });
      const invalid = error ? undefined : completionError(data);
      const ok = !error && !invalid;
      const payload = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
      await checkpoint(client, "after worker payload validation", { jobId: id, valid: ok, status: payload?.status ?? null });
      results.push({ jobId: id, ok, result: data ?? null, status: payload?.status ?? null, error: error ?? invalid ?? null, validationError: invalid ?? null });
      const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary as Record<string, unknown> : payload;
      const timings = summary?.stageTimingsMs && typeof summary.stageTimingsMs === "object" ? summary.stageTimingsMs as Record<string, unknown> : undefined;
      if (timings) for (const [stage, durationMs] of Object.entries(timings)) await log(client, [id], "reconciliation stage completed", { stage, durationMs });
      if (ok) { await checkpoint(client, "before worker completion log write", { jobId: id }); await log(client, [id], "worker completed"); await checkpoint(client, "after worker completion log write", { jobId: id }); }
    }
    const failed = results.filter(result => result.ok === false);
    const firstFailure = failed[0];
    const response = { claimed: ids.length, claimedJobIds: ids, started: ids.length > 0, completed: results.length - failed.length, failed: failed.length, error: firstFailure ? (firstFailure.result ?? firstFailure.error) : null, validationError: firstFailure?.validationError ?? null, results };
    if (triggerJobId) await checkpoint(client, "before worker runner return", { claimed: response.claimed, failed: response.failed });
    return response;
  } catch (error) {
    const detail = error as { code?: unknown; message?: unknown };
    console.error("[supplier-import] worker exception", { operation, elapsedMs: Date.now() - workerStartedAt, exceptionType: error instanceof Error ? error.name : typeof error, code: detail?.code ?? null, message: error instanceof Error ? error.message : String(error) });
    return { claimed: 0, claimedJobIds: [], started: false, completed: 0, failed: 1, error, results: [] };
  }
}
