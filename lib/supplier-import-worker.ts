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

export async function runQueuedSupplierImportWorker(triggerJobId?: string) {
  try {
    console.info("[supplier-import] shared worker runner entered", { triggerJobId });
    const client = workerClient();
    console.info("[supplier-import] service-role client created", { triggerJobId });
    if (triggerJobId) await log(client, [triggerJobId], "after() callback executed");
    if (triggerJobId) await log(client, [triggerJobId], "job successfully queued");
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
      const { data, error } = await client.rpc("club_run_supplier_import_job", { p_job_id: id });
      results.push({ jobId: id, ok: !error, result: data ?? null, error: error?.message ?? null });
      if (!error) await log(client, [id], "worker completed");
    }
    const failed = results.filter(result => result.ok === false);
    return { claimed: ids.length, claimedJobIds: ids, started: ids.length > 0, completed: results.length - failed.length, failed: failed.length, error: failed[0]?.error ?? null, results };
  } catch (error) {
    return { claimed: 0, claimedJobIds: [], started: false, completed: 0, failed: 1, error: error instanceof Error ? error.message : String(error), results: [] };
  }
}
