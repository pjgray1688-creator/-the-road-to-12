import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { authAccountHref } from "@/lib/auth-app";
import { authDestination } from "@/lib/auth-return";
import { serverSupabase } from "@/lib/supabase-server";

const allowedTypes = new Set<EmailOtpType>(["email", "signup", "invite", "magiclink", "recovery", "email_change"]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const rawType = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const context = authDestination({ app: request.nextUrl.searchParams.get("app"), next: request.nextUrl.searchParams.get("next") }, true);
  if (!tokenHash || !rawType || !allowedTypes.has(rawType)) {
    const failed = new URL(authAccountHref(context.app, "signIn", context.next), request.nextUrl.origin);
    failed.searchParams.set("verification", "invalid");
    return NextResponse.redirect(failed);
  }
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: rawType });
  if (error) {
    console.warn("auth_confirmation_failed", { code: error.code, app: context.app });
    const failed = new URL(authAccountHref(context.app, "signIn", context.next), request.nextUrl.origin);
    failed.searchParams.set("verification", "expired");
    return NextResponse.redirect(failed);
  }
  const destination = new URL(context.next, request.nextUrl.origin);
  destination.searchParams.set("verified", "1");
  return NextResponse.redirect(destination);
}
