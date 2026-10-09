import { NextRequest } from "next/server";

export type WorkerAuthResult = "authorized" | "missing_configuration" | "unauthorized";

/** Accept a dedicated worker secret and Vercel's shared CRON_SECRET header. */
export function verifyInternalWorkerAuth(request: Pick<NextRequest, "headers">, secrets: Array<string | undefined>): WorkerAuthResult {
  const configured = secrets.map(value => value?.trim()).filter((value): value is string => Boolean(value));
  if (!configured.length) return "missing_configuration";
  const authorization = request.headers.get("authorization");
  if (authorization && configured.some(secret => authorization === `Bearer ${secret}`)) return "authorized";
  return "unauthorized";
}
