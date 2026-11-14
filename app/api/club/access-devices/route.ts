import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: noStore });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return fail("This request could not be verified.", 403);
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail("Sign in with a Madhouse owner or gym admin account.", 401);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.organisationId !== "string" || !uuidPattern.test(body.organisationId)) return fail("Invalid organisation.", 400);
  const organisationId = body.organisationId;

  if (body.action === "provision") {
    if (typeof body.locationId !== "string" || !uuidPattern.test(body.locationId)
      || typeof body.deviceId !== "string" || !uuidPattern.test(body.deviceId)
      || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80) {
      return fail("Enter a valid Rotherham device name and location.", 400);
    }
    const deviceSecret = randomBytes(32).toString("base64url");
    const secretHash = createHash("sha256").update(deviceSecret, "utf8").digest();
    const { data, error } = await client.rpc("club_provision_rotherham_akuvox_device", {
      p_organisation_id: organisationId,
      p_location_id: body.locationId,
      p_device_id: body.deviceId,
      p_name: body.name.trim(),
      p_secret_hash: `\\x${secretHash.toString("hex")}`,
    });
    if (error || data !== body.deviceId) {
      const status = error?.code === "42501" ? 403 : error?.code === "22023" ? 400 : 409;
      return fail(status === 403 ? "Only an active Madhouse owner or gym admin can provision this Rotherham device." : "The Rotherham device could not be provisioned. Check the selected venue and try again.", status);
    }
    // The raw secret is returned once, never stored in the database or logs.
    return NextResponse.json({ ok: true, deviceId: data, deviceSecret, status: "disabled" }, { headers: noStore });
  }

  if (body.action === "status") {
    if (typeof body.deviceId !== "string" || !uuidPattern.test(body.deviceId)
      || (body.status !== "active" && body.status !== "disabled")
      || (body.status === "disabled" && (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 300))) {
      return fail("Invalid device status request.", 400);
    }
    const { data, error } = await client.rpc("club_set_rotherham_akuvox_device_status", {
      p_organisation_id: organisationId,
      p_device_id: body.deviceId,
      p_status: body.status,
      p_reason: typeof body.reason === "string" ? body.reason.trim() : null,
    });
    if (error) {
      const forbidden = error.code === "42501";
      return fail(forbidden ? "Only an active Madhouse owner or gym admin can change this device." : "The device status could not be changed. An active device can only be enabled while Rotherham is Check-in only.", forbidden ? 403 : 409);
    }
    return NextResponse.json({ ok: true, device: data }, { headers: noStore });
  }

  return fail("Unsupported device action.", 400);
}
