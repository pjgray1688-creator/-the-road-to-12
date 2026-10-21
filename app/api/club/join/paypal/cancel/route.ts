import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // A return to the cancel URL is not proof of a provider-side cancellation.
  // Keep the order pending until a verified webhook confirms its terminal state.
  return NextResponse.redirect(new URL("/join/madhouse?billing=paypal-cancelled", request.url));
}
