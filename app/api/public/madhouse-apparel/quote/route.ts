import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validHandoff(raw: string, request: NextRequest) {
  const secret = process.env.R12_APPAREL_CHECKOUT_HMAC_SECRET;
  const timestamp = request.headers.get("x-r12-timestamp") ?? "";
  const signature = request.headers.get("x-r12-signature") ?? "";
  if (!secret || Buffer.byteLength(secret) < 32 || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)
    || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 12_000) return NextResponse.json({ error: "Basket is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });
  if (!validHandoff(raw, request)) return NextResponse.json({ error: "Price quotation is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  let items: unknown;
  try { items = (JSON.parse(raw) as { items?: unknown }).items; }
  catch { return NextResponse.json({ error: "Basket is invalid." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30 || items.some((item) => {
    if (!item || typeof item !== "object") return true;
    const row = item as Record<string, unknown>;
    return typeof row.productId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.productId)
      || !["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"].includes(String(row.size))
      || !Number.isSafeInteger(row.quantity) || Number(row.quantity) < 1 || Number(row.quantity) > 20;
  })) return NextResponse.json({ error: "Choose valid garments, sizes and quantities." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const reference = randomUUID().slice(0, 8).toUpperCase();
  try {
    const { data, error } = await adminSupabase().rpc("club_quote_madhouse_apparel_checkout", { p_items: items });
    if (error || !data || typeof data !== "object") {
      const detail = error as { code?: unknown; message?: unknown } | null;
      console.error("[madhouse-apparel-quote] rejected", { reference, code: typeof detail?.code === "string" ? detail.code : "UNKNOWN", message: typeof detail?.message === "string" ? detail.message.slice(0, 240) : "invalid RPC response" });
      return NextResponse.json({ error: "We couldn’t confirm the current price for this basket. Refresh the basket and try again.", reference }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const quote = data as Record<string, unknown>;
    if (quote.currency !== "GBP" || !Number.isSafeInteger(quote.subtotal_minor) || !Number.isSafeInteger(quote.discount_minor)
      || !Number.isSafeInteger(quote.delivery_minor) || quote.delivery_minor !== 395 || !Number.isSafeInteger(quote.total_minor)
      || !Array.isArray(quote.lines) || quote.lines.length !== items.length) throw new Error("Quote response contract invalid");
    const lines = quote.lines.map((value) => {
      if (!value || typeof value !== "object") throw new Error("Quote line invalid");
      const row = value as Record<string, unknown>;
      if (typeof row.slug !== "string" || typeof row.name !== "string" || typeof row.colour !== "string"
        || typeof row.size !== "string" || !Number.isSafeInteger(row.quantity)
        || !Number.isSafeInteger(row.unit_price_minor) || !Number.isSafeInteger(row.discount_quantity)) throw new Error("Quote line invalid");
      return { slug: row.slug, name: row.name, colour: row.colour, size: row.size, quantity: row.quantity, unit_price_minor: row.unit_price_minor, discount_quantity: row.discount_quantity };
    });
    return NextResponse.json({ currency: "GBP", subtotal_minor: quote.subtotal_minor, discount_minor: quote.discount_minor,
      delivery_minor: 395, total_minor: quote.total_minor, promotion_applied: quote.promotion_applied === true, lines }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[madhouse-apparel-quote] failed", { reference, reason: error instanceof Error ? error.message.slice(0, 240) : "unknown" });
    return NextResponse.json({ error: "Price quotation is temporarily unavailable. Please try again.", reference }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
