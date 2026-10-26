import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { authAccountHref } from "@/lib/auth-app";
import { authDestination } from "@/lib/auth-return";
import { serverSupabase } from "@/lib/supabase-server";

const allowedTypes = new Set<EmailOtpType>(["email"]);

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = typeof form.get("token_hash") === "string" ? String(form.get("token_hash")) : null;
  const rawType = (typeof form.get("type") === "string" ? String(form.get("type")) : null) as EmailOtpType | null;
  const context = authDestination({ app: typeof form.get("app") === "string" ? String(form.get("app")) : null, next: typeof form.get("next") === "string" ? String(form.get("next")) : null }, true);
  if (!tokenHash || !rawType || !allowedTypes.has(rawType)) {
    const failed = new URL(authAccountHref(context.app, "signIn", context.next), request.nextUrl.origin);
    failed.searchParams.set("verification", "invalid");
    return NextResponse.redirect(failed, 303);
  }
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: rawType });
  if (error) {
    console.warn("auth_confirmation_failed", { code: error.code, app: context.app });
    const failed = new URL(authAccountHref(context.app, "signIn", context.next), request.nextUrl.origin);
    failed.searchParams.set("verification", "expired");
    return NextResponse.redirect(failed, 303);
  }
  const destination = new URL(context.next, request.nextUrl.origin);
  destination.searchParams.set("verified", "1");
  return NextResponse.redirect(destination, 303);
}
