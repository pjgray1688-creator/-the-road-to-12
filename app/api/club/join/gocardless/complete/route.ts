import { NextRequest, NextResponse } from "next/server";
import { completeGoCardlessRedirectFlow, retrieveGoCardlessMandate } from "@/lib/gocardless-join-provider";
import { siteUrl } from "@/lib/site-url";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Context = { id: string; organisation_slug: string; gocardless_redirect_flow_id?: string | null };

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get("request_id") ?? "";
  const flowId = request.nextUrl.searchParams.get("redirect_flow_id") ?? "";
  const fallback = new URL("/join?billing=mandate-failed", siteUrl());
  if (!requestId || !flowId) return NextResponse.redirect(fallback);
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email_confirmed_at) return NextResponse.redirect(new URL(`/account?mode=signIn&next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`, siteUrl()));
    const { data, error } = await supabase.rpc("club_prepare_recurring_mandate_attempt", { p_request_id: requestId, p_replace_reference: null });
    if (error || !data) throw new Error("Joining attempt is unavailable");
    const context = data as Context;
    const cookieName = `r12_gc_${requestId}`;
    const stored = request.cookies.get(cookieName)?.value;
    const session = stored ? JSON.parse(stored) as { flowId: string; token: string } : null;
    if (!session || session.flowId !== flowId || context.gocardless_redirect_flow_id !== flowId || !session.token) throw new Error("Direct Debit return could not be verified");
    const flow = await completeGoCardlessRedirectFlow(flowId, session.token);
    const mandateId = flow.links?.mandate;
    if (!mandateId || !flow.links?.customer || !flow.links?.customer_bank_account) throw new Error("GoCardless did not create a complete mandate record");
    const admin = adminSupabase();
    const { error: storeError } = await admin.rpc("club_store_join_provider_resource", {
      p_request_id: requestId, p_provider_type: "gocardless", p_primary_reference: flowId, p_payment_reference: null,
      p_customer_reference: flow.links.customer, p_bank_account_reference: flow.links.customer_bank_account, p_mandate_reference: mandateId,
    });
    if (storeError) throw storeError;
    const { error: bindError } = await admin.rpc("club_bind_replacement_gocardless_mandate", { p_request_id: requestId, p_mandate_id: mandateId, p_customer_id: flow.links.customer });
    if (bindError) throw bindError;
    const mandate = await retrieveGoCardlessMandate(mandateId);
    if (mandate.status === "active") {
      const { error: eventError } = await admin.rpc("club_record_join_provider_event", {
        p_request_id: requestId, p_provider_type: "gocardless", p_provider_event_key: `redirect-flow:${flowId}:active`,
        p_event_type: "mandate_confirmed", p_amount_minor: null, p_provider_reference: mandateId, p_occurred_at: new Date().toISOString(),
      });
      if (eventError) throw eventError;
      const { error: recurringError } = await admin.rpc("club_reconcile_gocardless_mandate_event", {
        p_provider_event_key: `redirect-flow:${flowId}:arrangement-active`, p_mandate_id: mandateId,
        p_provider_status: "active", p_occurred_at: new Date().toISOString(),
      });
      if (recurringError) throw recurringError;
    } else if (["failed", "cancelled", "expired", "replaced"].includes(mandate.status)) {
      const { error: eventError } = await admin.rpc("club_record_join_provider_event", {
        p_request_id: requestId, p_provider_type: "gocardless", p_provider_event_key: `redirect-flow:${flowId}:${mandate.status}`,
        p_event_type: "mandate_failed", p_amount_minor: null, p_provider_reference: mandateId, p_occurred_at: new Date().toISOString(),
      });
      if (eventError) throw eventError;
    }
    const response = NextResponse.redirect(new URL(`/join/${encodeURIComponent(context.organisation_slug)}?billing=mandate-returned`, siteUrl()));
    response.cookies.delete(cookieName);
    return response;
  } catch {
    return NextResponse.redirect(fallback);
  }
}
