import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function GET() {
  try {
    const client = await serverSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return failure("Sign in to view your account deletion request.", 401);
    const { data, error } = await client.rpc("r12_get_own_account_deletion_request");
    if (error) { console.error("account_deletion_status_failed", { code: error.code, details: error.details }); return failure("Account deletion requests are temporarily unavailable.", 503); }
    return NextResponse.json(data ?? { status: "none" }, { headers: noStore });
  } catch (error) {
    console.error("account_deletion_status_exception", { error: error instanceof Error ? error.message : "unknown" });
    return failure("Account deletion requests are temporarily unavailable.", 503);
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return failure("This request could not be verified.", 403);
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user?.id || !user.email) return failure("Sign in with the account you want to delete.", 401);

  const body = await request.json().catch(() => null) as { password?: unknown; confirmation?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
  if (!password || password.length > 1024 || confirmation !== "DELETE") return failure("Re-enter your password and type DELETE to confirm.", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return failure("Account deletion requests are temporarily unavailable.", 503);
  try {
    // Stateless verifier: confirm the signed-in user's password without
    // replacing the existing session or retaining the supplied password.
    const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const verified = await verifier.auth.signInWithPassword({ email: user.email, password });
    if (verified.error || verified.data.user?.id !== user.id) return failure("Password confirmation failed. Check your password and try again.", 401);

    const result = await adminSupabase().rpc("r12_submit_account_deletion_request", { p_user_id: user.id });
    if (result.error || !result.data) { console.error("account_deletion_submit_failed", { code: result.error?.code, details: result.error?.details }); return failure("Account deletion requests are temporarily unavailable.", 503); }
    return NextResponse.json(result.data, { status: 202, headers: noStore });
  } catch (error) {
    console.error("account_deletion_submit_exception", { error: error instanceof Error ? error.message : "unknown" });
    return failure("Account deletion requests are temporarily unavailable.", 503);
  }
}
