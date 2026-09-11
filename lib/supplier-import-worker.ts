import { createClient } from "@supabase/supabase-js";

function workerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase worker configuration is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function runQueuedSupplierImportWorker() {
  const client = workerClient();
  const { data: claimed, error: claimError } = await client.rpc("club_claim_supplier_import_jobs", { p_limit: 1 });
  if (claimError) throw claimError;
  const ids = Array.isArray(claimed) ? claimed : [];
  console.info("[supplier-import] jobs claimed", { count: ids.length, jobIds: ids });
  const results: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const { data, error } = await client.rpc("club_run_supplier_import_job", { p_job_id: id });
    results.push({ jobId: id, ok: !error, result: data ?? null, error: error?.message ?? null });
  }
  return { claimed: ids.length, results };
}
