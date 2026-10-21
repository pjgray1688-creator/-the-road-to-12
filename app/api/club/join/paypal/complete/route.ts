import { NextRequest, NextResponse } from "next/server";
import { capturePayPalOrderForBuyer } from "@/lib/paypal-pay-in-3-reconciliation";
import { serverSupabase } from "@/lib/supabase-server";
import { siteUrl } from "@/lib/site-url";

export async function GET(request: NextRequest) {
  const base = siteUrl();
  const providerOrderId = request.nextUrl.searchParams.get("token");
  if (!providerOrderId || providerOrderId.length > 80) {
    return NextResponse.redirect(new URL("/join/madhouse?billing=paypal-pending", base));
  }
  let confirmed = false;
  try {
    const session = await serverSupabase();
    const { data: { user } } = await session.auth.getUser();
    if (user?.email_confirmed_at) {
      await capturePayPalOrderForBuyer(providerOrderId, user.id);
      confirmed = true;
    }
  } catch {
    // The verified webhook can still complete reconciliation asynchronously.
  }
  return NextResponse.redirect(new URL(confirmed ? "/join/madhouse?billing=paypal-confirmed" : "/join/madhouse?billing=paypal-pending", base));
}
