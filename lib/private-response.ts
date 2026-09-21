import { NextResponse } from "next/server";

/**
 * Build a JSON response that must never be shared between authenticated users
 * or persisted by an intermediate cache.
 */
export function privateJson<T>(body: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  headers.set("Vary", "Cookie");

  return NextResponse.json(body, { ...init, headers });
}
