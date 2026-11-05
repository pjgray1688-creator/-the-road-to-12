import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { readStripeMerchantConfig, stripeMerchantRequest, verifyStripeMerchantAccount } from "@/lib/stripe-merchant";
import { assertStripeLiveCheckoutEnabled, stripeMerchantForCategory } from "@/lib/stripe-routing-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ORG = "fa44592a-1593-4ad3-a621-63a4a4bcbceb";
const safeText = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max && !/[\r\n]/.test(value);

function authenticatedHandoff(raw: string, request: NextRequest) {
  const secret = process.env.R12_APPAREL_CHECKOUT_HMAC_SECRET;
  const timestamp = request.headers.get("x-r12-timestamp") ?? "";
  const signature = request.headers.get("x-r12-signature") ?? "";
  if (!secret || Buffer.byteLength(secret) < 32 || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

type PreparedOrder = { order_id: string; attempt_id: string; order_number: string; total_minor: number; confirmation_token: string; lines: Array<{ product_id: string; product_name: string; colour: string; size: string; quantity: number; discount_quantity: number; unit_price_minor: number; currency: string }> };
type StripeSessionCustomer = string | { id: string } | null;
type StripeSession = { status?: string; id: string; url: string | null; mode: string; amount_total: number | null; customer: StripeSessionCustomer };

type SafePgDiagnostic = { sqlstate?: string; postgrestCode?: string; constraint?: string; table?: string; column?: string; category?: string };
const SAFE_PG_CATEGORIES: Record<string, string> = {
  "23502": "not_null_violation", "23503": "foreign_key_violation", "23505": "unique_violation",
  "23514": "check_violation", "42703": "undefined_column", "42P01": "undefined_table",
  "42883": "undefined_function", "42501": "insufficient_privilege", "22023": "invalid_parameter",
  "PGRST202": "rpc_not_found_or_schema_cache",
};
const safeDbIdentifier = (value: unknown) => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value) ? value : undefined;

class CheckoutDatabaseError extends Error {
  readonly diagnostic: SafePgDiagnostic;
  constructor(source: unknown) {
    super("checkout_database_rpc_failed");
    this.name = "CheckoutDatabaseError";
    const error = source && typeof source === "object" ? source as Record<string, unknown> : {};
    const code = typeof error.code === "string" && /^[0-9A-Z]{5,8}$/.test(error.code) ? error.code : undefined;
    const searchable = [error.message, error.details, error.hint].filter((value): value is string => typeof value === "string").join(" ");
    const findIdentifier = (kind: "constraint" | "table" | "column") => {
      const match = searchable.match(new RegExp(`${kind} ["']([A-Za-z_][A-Za-z0-9_]{0,62})["']`, "i"));
      return safeDbIdentifier(match?.[1] ?? error[`${kind}_name`]);
    };
    this.diagnostic = {
      ...(code && code.length === 5 ? { sqlstate: code } : {}),
      ...(code && /^PGRST[0-9A-Z]+$/.test(code) ? { postgrestCode: code } : {}),
      ...(findIdentifier("constraint") ? { constraint: findIdentifier("constraint") } : {}),
      ...(findIdentifier("table") ? { table: findIdentifier("table") } : {}),
      ...(findIdentifier("column") ? { column: findIdentifier("column") } : {}),
      ...(code && SAFE_PG_CATEGORIES[code] ? { category: SAFE_PG_CATEGORIES[code] } : {}),
    };
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 32_000) return NextResponse.json({ error: "Checkout request is too large." }, { status: 413 });
  if (!authenticatedHandoff(raw, request)) { console.warn("[madhouse-apparel-checkout] handoff rejected", { stage: "hmac", reason: "signature_or_timestamp_invalid" }); return NextResponse.json({ error: "Checkout service is unavailable." }, { status: 503 }); }
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw) as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid checkout request." }, { status: 400 }); }
  const customer = input.customer as Record<string, unknown> | undefined;
  const delivery = input.deliveryAddress as Record<string, unknown> | undefined;
  const billing = input.billingAddress as Record<string, unknown> | undefined;
  const items = input.items;
  const same = input.billingSameAsDelivery === true;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey) || !customer || !delivery || !Array.isArray(items) || items.length < 1 || items.length > 30
    || !safeText(customer.firstName,100) || !safeText(customer.surname,100) || !safeText(customer.phone,40)
    || typeof customer.email !== "string" || customer.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)
    || !safeText(delivery.line1,180) || delivery.line2 != null && delivery.line2!=="" && !safeText(delivery.line2,180)
    || !safeText(delivery.town,100) || delivery.county != null && delivery.county!=="" && !safeText(delivery.county,100)
    || !safeText(delivery.postcode,20) || String(delivery.country ?? "GB").toUpperCase()!=="GB"
    || !same && (!billing || !safeText(billing.line1,180) || billing.line2 != null && billing.line2!=="" && !safeText(billing.line2,180)
      || !safeText(billing.town,100) || billing.county != null && billing.county!=="" && !safeText(billing.county,100)
      || !safeText(billing.postcode,20) || String(billing.country ?? "GB").toUpperCase()!=="GB")) {
    return NextResponse.json({ error: "Check your contact and UK address details." }, { status: 400 });
  }
  if (items.some(line => !line || typeof line !== "object" || typeof (line as Record<string,unknown>).productId!=="string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String((line as Record<string,unknown>).productId))
    || !["S","M","L","XL","2XL","3XL","4XL","5XL"].includes(String((line as Record<string,unknown>).size))
    || !Number.isSafeInteger((line as Record<string,unknown>).quantity) || Number((line as Record<string,unknown>).quantity)<1 || Number((line as Record<string,unknown>).quantity)>20)) {
    return NextResponse.json({ error: "A basket item is invalid. Refresh the collection and try again." }, { status: 400 });
  }

  const base = process.env.MADHOUSE_APPAREL_SITE_URL?.trim();
  if (base !== "https://madhousegym.online") return NextResponse.json({ error: "Apparel checkout is not configured." }, { status: 503 });
  let prepared: PreparedOrder | null = null;
  let sessionId: string | null = null;
  let merchantConfig: ReturnType<typeof readStripeMerchantConfig> | null = null;
  let stage = "order_preparation";
  const reference = randomUUID().slice(0, 8).toUpperCase();
  try {
    stage = "order_preparation";
    const { data, error } = await adminSupabase().rpc("club_prepare_madhouse_apparel_checkout", { p_payload: input, p_idempotency_key: idempotencyKey });
    if (error) throw new CheckoutDatabaseError(error);
    if (!data || typeof data !== "object") throw new Error("checkout_database_rpc_invalid_response");
    prepared = data as PreparedOrder;
    if (!prepared.order_id || !prepared.attempt_id || !prepared.confirmation_token || !Number.isSafeInteger(prepared.total_minor) || !prepared.lines?.length) throw new Error("Order preparation was incomplete");

    const quotedTotal = input.quotedTotalMinor;
    if (quotedTotal !== undefined && (!Number.isSafeInteger(quotedTotal) || quotedTotal !== prepared.total_minor)) {
      const { error: abortError } = await adminSupabase().rpc("club_abort_stripe_commerce_attempt", { p_attempt_id: prepared.attempt_id, p_reason: "Website quote changed before checkout" });
      if (abortError) throw new Error("Price changed and pending attempt could not be safely cancelled");
      prepared = null;
      return NextResponse.json({ error: "The basket price changed. Please review the updated total before continuing.", code: "QUOTE_CHANGED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    stage = "merchant_policy";
    const merchant = stripeMerchantForCategory("other_product_or_service");
    if (merchant !== "madhouse_products_services") throw new Error("Apparel merchant policy mismatch");
    const config = merchantConfig = readStripeMerchantConfig(merchant);
    stage = "live_checkout_gate";
    assertStripeLiveCheckoutEnabled(merchant, config.mode);
    stage = "merchant_account_verification";
    await verifyStripeMerchantAccount(merchant);
    const admin = adminSupabase();
    stage = "merchant_binding";
    const { error: bindingError } = await admin.rpc("club_bind_stripe_commerce_account", { p_attempt_id: prepared.attempt_id, p_account_id: config.accountId });
    if (bindingError) throw new Error("Products & Services merchant binding is unavailable");

    const body = new URLSearchParams({ mode:"payment", customer_email:String(customer.email).trim().toLowerCase(), customer_creation:"if_required",
      client_reference_id:prepared.attempt_id, success_url:`${base}/apparel/order-confirmation/${prepared.confirmation_token}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${base}/apparel/checkout?cancelled=1`, billing_address_collection:"auto",
      "shipping_address_collection[allowed_countries][0]":"GB",
      "payment_method_types[0]":"card", "metadata[merchant_entity]":"madhouse_products_services",
      "metadata[payment_attempt_id]":prepared.attempt_id,"metadata[order_id]":prepared.order_id,"metadata[order_number]":prepared.order_number,
      "payment_intent_data[metadata][merchant_entity]":"madhouse_products_services",
      "payment_intent_data[metadata][payment_attempt_id]":prepared.attempt_id,"payment_intent_data[metadata][order_id]":prepared.order_id,
    });
    const stripeLines: Array<{name:string;price:number;quantity:number}> = [];
    for(const line of prepared.lines){
      const discounted=Math.max(0,Math.min(line.quantity,line.discount_quantity));
      const regular=line.quantity-discounted;
      const name=`${line.product_name} · ${line.colour} · ${line.size}`;
      if(regular>0) stripeLines.push({name,price:line.unit_price_minor,quantity:regular});
      if(discounted>0) stripeLines.push({name:`${name} (hoodie + T-shirt offer)`,price:line.unit_price_minor-Math.floor(line.unit_price_minor/2),quantity:discounted});
    }
    stripeLines.push({name:"UK delivery",price:395,quantity:1});
    stripeLines.forEach((line,index)=>{
      body.set(`line_items[${index}][price_data][currency]`,"gbp");
      body.set(`line_items[${index}][price_data][unit_amount]`,String(line.price));
      body.set(`line_items[${index}][price_data][product_data][name]`,line.name);
      body.set(`line_items[${index}][quantity]`,String(line.quantity));
    });
    stage = "stripe_session_creation";
    const session=await stripeMerchantRequest<StripeSession>(merchant,"/checkout/sessions",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":`madhouse-apparel-session-${prepared.attempt_id}`},body,
    });
    sessionId = session.id;
    stage = "stripe_amount_verification";
    if (session.mode!=="payment" || !session.url || session.amount_total!==prepared.total_minor || session.id?.startsWith("cs_")!==true) throw new Error("Stripe session total did not match the R12 order");
    stage = "order_session_link";
    const stripeCustomerId: string | null = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const { error: storeError }=await admin.rpc("club_store_stripe_commerce_session",{p_attempt_id:prepared.attempt_id,p_account_id:config.accountId,p_session_id:session.id,p_customer_id:stripeCustomerId});
    if (storeError) throw new Error("Stripe session could not be linked to the R12 order");
    stage = "apparel_session_link";
    const { error: detailsError }=await admin.rpc("club_set_madhouse_apparel_session",{p_attempt_id:prepared.attempt_id,p_session_id:session.id});
    if (detailsError) throw new Error("Apparel order details could not be linked");
    return NextResponse.json({url:session.url},{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    const diagnostic = error as { code?: unknown; type?: unknown; statusCode?: unknown };
    console.error("[madhouse-apparel-checkout] failed", { reference, stage,
      errorType: error instanceof Error ? error.name : "unknown",
      ...(error instanceof CheckoutDatabaseError ? error.diagnostic : {}),
      providerCode: typeof diagnostic?.code === "string" ? diagnostic.code.slice(0, 80) : undefined,
      providerType: typeof diagnostic?.type === "string" ? diagnostic.type.slice(0, 80) : undefined,
      statusCode: Number.isInteger(diagnostic?.statusCode) ? diagnostic.statusCode : undefined });
    if (prepared) {
      try {
        const admin = adminSupabase();
        let safeToAbort = !sessionId;
        if (sessionId && merchantConfig) {
          const expired = await stripeMerchantRequest<StripeSession>("madhouse_products_services",`/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,{method:"POST"});
          safeToAbort = expired.status === "expired";
        }
        if (safeToAbort) await admin.rpc("club_abort_stripe_commerce_attempt",{p_attempt_id:prepared.attempt_id,p_reason:"Apparel checkout could not be safely linked"});
      } catch { /* keep a potentially payable attempt for webhook reconciliation */ }
    }
    return NextResponse.json({error:"Secure checkout could not be started. Your basket has been kept.",reference},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
