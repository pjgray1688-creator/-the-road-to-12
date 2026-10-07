import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function GET(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const timezone = new URL(request.url).searchParams.get("timezone");
  const { data, error } = await client.rpc("nutrition_get_member_view", { p_requested_timezone: timezone });
  if (error) return privateJson({ error: "Nutrition is temporarily unavailable" }, { status: 503 });
  return privateJson(data ?? { plan: null, checkins: [], checkinDays: [], feedback: [] });
}

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "checkin";
  let rpc = "nutrition_save_daily_checkin";
  let params: Record<string, unknown> = {
    p_adherence: body.adherence,
    p_client_note: typeof body.clientNote === "string" ? body.clientNote : "",
    p_timezone: typeof body.timezone === "string" ? body.timezone : "Europe/London",
  };
  const timezone = typeof body.timezone === "string" ? body.timezone : "Europe/London";
  if (action === "extra") { rpc = "nutrition_add_extra"; params = { p_description: body.description, p_amount_text: body.amountText ?? "", p_note: body.note ?? "", p_timezone: timezone }; }
  if (action === "update-extra") { rpc = "nutrition_update_extra"; params = { p_extra_id: body.id, p_description: body.description, p_amount_text: body.amountText ?? "", p_note: body.note ?? "", p_timezone: timezone }; }
  if (action === "delete-extra") { rpc = "nutrition_delete_extra"; params = { p_extra_id: body.id, p_timezone: timezone }; }
  const { data, error } = await client.rpc(rpc, params);
  if (error) return privateJson({ error: error.code === "42501" ? "You cannot change this nutrition record." : error.message.includes("No active") ? "There is no active nutrition plan yet." : "That nutrition update could not be saved." }, { status: error.code === "42501" ? 403 : 400 });
  return privateJson(data ?? { status: "saved" });
}
