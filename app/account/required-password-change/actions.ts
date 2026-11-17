"use server";

import { serverSupabase } from "@/lib/supabase-server";
import { adminSupabase } from "@/lib/supabase-admin";
import { validateAuthPassword } from "@/lib/auth-password-policy";

export async function completeRequiredPasswordChange(input: { password: string; confirmation: string }) {
  const validation = validateAuthPassword(input.password, input.confirmation);
  if (validation) return { ok: false as const, code: validation };

  try {
    const client = await serverSupabase();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return { ok: false as const, code: "not_authorized" as const };

    const admin = adminSupabase();
    const { data, error: lookupError } = await admin.auth.admin.getUserById(user.id);
    if (lookupError || !data.user || data.user.app_metadata?.password_change_required !== true) {
      return { ok: false as const, code: "not_required" as const };
    }

    const appMetadata = { ...data.user.app_metadata, password_change_required: false };
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password: input.password,
      app_metadata: appMetadata,
    });
    if (updateError) return { ok: false as const, code: "auth_rejected" as const };
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "failed" as const };
  }
}
