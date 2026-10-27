import { randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";

export const deletionTestPurpose = "r12_account_deletion_e2e";
export const deletionTestMarkerVersion = 1;

const runIdPattern = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

export type DisposableTestMarker = {
  version: number;
  purpose: string;
  run_id: string;
  originating_app: "glow";
};

export type DisposableTestCredentials = {
  version: 1;
  userId: string;
  email: string;
  password: string;
  runId: string;
  purpose: typeof deletionTestPurpose;
};

type AdminAuth = {
  listUsers(params: { page: number; perPage: number }): Promise<{
    data: { users: User[]; nextPage?: number | null };
    error: { message?: string } | null;
  }>;
  createUser(attributes: {
    email: string;
    password: string;
    email_confirm: true;
    user_metadata: Record<string, unknown>;
    app_metadata: Record<string, unknown>;
  }): Promise<{ data: { user: User | null }; error: { message?: string } | null }>;
  getUserById(userId: string): Promise<{ data: { user: User | null }; error: { message?: string; status?: number } | null }>;
  deleteUser(userId: string, shouldSoftDelete: false): Promise<{ error: { message?: string } | null }>;
};

export function validateDeletionTestRunId(value: string) {
  const runId = value.trim().toLowerCase();
  if (!runIdPattern.test(runId)) {
    throw new Error("Run ID must be 3-48 lowercase letters, numbers or internal hyphens.");
  }
  return runId;
}

export function disposableDeletionTestEmail(runIdValue: string) {
  const runId = validateDeletionTestRunId(runIdValue);
  return `r12-deletion-${runId}@example.test`;
}

export function disposableDeletionTestMarker(runIdValue: string): DisposableTestMarker {
  return {
    version: deletionTestMarkerVersion,
    purpose: deletionTestPurpose,
    run_id: validateDeletionTestRunId(runIdValue),
    originating_app: "glow",
  };
}

export function generateTemporaryDeletionTestPassword() {
  return `R12!${randomBytes(32).toString("base64url")}aA7`;
}

function markerFrom(user: User) {
  const marker = user.app_metadata?.r12_disposable_test;
  return marker && typeof marker === "object" && !Array.isArray(marker)
    ? marker as Record<string, unknown>
    : null;
}

export function isExactDisposableDeletionTestUser(user: User, runIdValue: string) {
  const runId = validateDeletionTestRunId(runIdValue);
  const marker = markerFrom(user);
  return user.email?.toLowerCase() === disposableDeletionTestEmail(runId)
    && Boolean(user.email_confirmed_at)
    && marker?.version === deletionTestMarkerVersion
    && marker?.purpose === deletionTestPurpose
    && marker?.run_id === runId
    && marker?.originating_app === "glow";
}

async function findExactEmail(admin: AdminAuth, email: string) {
  let page = 1;
  for (;;) {
    const result = await admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Could not verify that the disposable address is unused.");
    const match = result.data.users.find(user => user.email?.toLowerCase() === email);
    if (match) return match;
    if (!result.data.nextPage) return null;
    page = result.data.nextPage;
  }
}

/** Admin-only provisioning. createUser does not send an email; no invite or link API is used. */
export async function provisionDisposableDeletionTestUser(admin: AdminAuth, runIdValue: string): Promise<DisposableTestCredentials> {
  const runId = validateDeletionTestRunId(runIdValue);
  const email = disposableDeletionTestEmail(runId);
  if (await findExactEmail(admin, email)) {
    throw new Error("A disposable account already exists for this run ID; it will not be reused or overwritten.");
  }

  const password = generateTemporaryDeletionTestPassword();
  const marker = disposableDeletionTestMarker(runId);
  const created = await admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: "Disposable",
      last_name: "Deletion Test",
      app: "glow",
      disposable_test_account: true,
      test_purpose: deletionTestPurpose,
    },
    app_metadata: { r12_disposable_test: marker },
  });
  if (created.error || !created.data.user) throw new Error("Supabase refused to create the disposable account.");

  const userId = created.data.user.id;
  const verified = await admin.getUserById(userId);
  if (verified.error || !verified.data.user || !isExactDisposableDeletionTestUser(verified.data.user, runId)) {
    await admin.deleteUser(userId, false);
    throw new Error("Disposable account verification failed; the newly created identity was rolled back.");
  }

  return { version: 1, userId, email, password, runId, purpose: deletionTestPurpose };
}
