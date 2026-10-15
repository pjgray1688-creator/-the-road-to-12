import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return failure("This request could not be verified.", 403);
  const currentClient = await serverSupabase();
  const { data: { user } } = await currentClient.auth.getUser();
  if (!user?.id || !user.email) return failure("Sign in to manage your Club PIN.", 401);

  const body = await request.json().catch(() => null) as { organisationId?: unknown; password?: unknown; pin?: unknown; action?: unknown } | null;
  const organisationId = typeof body?.organisationId === "string" ? body.organisationId : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const action = body?.action === "disable" ? "disable" : body?.action === "set" ? "set" : null;
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!organisationId || !password || password.length > 1024 || !action || (action === "set" && !/^\d{4,6}$/.test(pin))) {
    return failure("Enter your password and a valid Club PIN.", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return failure("Club PIN settings are temporarily unavailable.", 503);
  try {
    // Stateless Auth client: verify the signed-in identity's password without
    // replacing or persisting the browser's existing session.
    const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const verified = await verifier.auth.signInWithPassword({ email: user.email, password });
    if (verified.error || verified.data.user?.id !== user.id) return failure("Password confirmation failed. Check your password and try again.", 401);

    const admin = adminSupabase();
    const result = await admin.rpc(action === "disable" ? "club_station_disable_pin_after_password" : "club_station_set_pin_after_password", {
      p_organisation_id: organisationId,
      p_user_id: user.id,
      ...(action === "set" ? { p_pin: pin } : {}),
    });
    if (result.error) {
      const status = result.error.code === "42501" ? 403 : result.error.code === "22023" ? 400 : 503;
      return failure(status === 403 ? "Active Club staff access is required." : status === 400 ? "Enter a valid Club PIN." : "Club PIN settings are temporarily unavailable.", status);
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch {
    return failure("Club PIN settings are temporarily unavailable.", 503);
  }
}
