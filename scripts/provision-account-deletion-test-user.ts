#!/usr/bin/env node
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { provisionDisposableDeletionTestUser, validateDeletionTestRunId } from "../lib/account-deletion-test-account";

function credentialPath(value: string | undefined) {
  if (!value || !isAbsolute(value)) throw new Error("R12_DELETION_TEST_CREDENTIALS_FILE must be an absolute path outside the repository.");
  const resolved = resolve(value);
  const fromRepository = relative(process.cwd(), resolved);
  if (!fromRepository.startsWith("..") || fromRepository === "") throw new Error("The credential file must be outside the repository.");
  return resolved;
}

function validateEnvironment(environment: NodeJS.ProcessEnv, requireSecrets: boolean) {
  const runId = validateDeletionTestRunId(environment.R12_DELETION_TEST_RUN_ID ?? "");
  const outputPath = credentialPath(environment.R12_DELETION_TEST_CREDENTIALS_FILE);
  if (requireSecrets && (!environment.NEXT_PUBLIC_SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("Supabase Admin environment is unavailable.");
  }
  if (requireSecrets && environment.R12_DELETION_TEST_PROVISION_CONFIRM !== "CREATE_ONE_DISPOSABLE_ACCOUNT") {
    throw new Error("Set the explicit disposable-account provisioning confirmation.");
  }
  return { runId, outputPath };
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  const mode = args[0];
  if (mode !== "--check" && mode !== "--provision") throw new Error("Use --check or --provision explicitly.");
  const config = validateEnvironment(environment, mode === "--provision");
  if (mode === "--check") {
    process.stdout.write("Disposable account provisioning inputs are valid; no account was created.\n");
    return;
  }

  // Reserve a private file before making the only remote mutation. This also
  // refuses accidental credential-file reuse without exposing its contents.
  const descriptor = openSync(config.outputPath, "wx", 0o600);
  let createdUserId = "";
  let admin: ReturnType<typeof createClient> | null = null;
  try {
    admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL!, environment.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const credentials = await provisionDisposableDeletionTestUser(admin.auth.admin, config.runId);
    createdUserId = credentials.userId;
    writeFileSync(descriptor, `${JSON.stringify(credentials, null, 2)}\n`);
    closeSync(descriptor);
    process.stdout.write(`Created one disposable deletion-test identity ${credentials.userId}. Credentials were written with mode 0600 to ${config.outputPath}.\n`);
  } catch {
    try { closeSync(descriptor); } catch { /* already closed */ }
    let rollbackConfirmed = true;
    if (admin && createdUserId) {
      const rollback = await admin.auth.admin.deleteUser(createdUserId, false);
      rollbackConfirmed = !rollback.error;
    }
    try { unlinkSync(config.outputPath); } catch { /* no credential file remains usable */ }
    if (!rollbackConfirmed) throw new Error(`Provisioning failed after identity ${createdUserId} was created and rollback was not confirmed. Quarantine that exact UUID; no credentials were logged.`);
    throw new Error("Disposable account provisioning stopped safely; no credentials were logged.");
  }
}

if (process.argv[1]?.endsWith("provision-account-deletion-test-user.ts")) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Provisioning failed safely."}\n`);
    process.exitCode = 1;
  });
}
