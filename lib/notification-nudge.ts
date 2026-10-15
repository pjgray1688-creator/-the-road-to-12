import { after } from "next/server";
import { siteUrl } from "./site-url";

/** Start the ordinary authenticated outbox worker after the queueing response is sent. */
export function nudgeNotificationWorker() {
  const secret = process.env.R12_NOTIFICATION_WORKER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const endpoint = new URL("/api/internal/notification-worker", siteUrl());
  after(async () => {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { authorization: `Bearer ${secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(250_000),
      });
      if (!response.ok) console.warn("[notifications] background worker nudge returned a non-success status", { status: response.status });
    } catch {
      // The daily authenticated cron remains the durable fallback if a nudge fails.
      console.warn("[notifications] background worker nudge failed; queued mail remains in the outbox");
    }
  });
  return true;
}
