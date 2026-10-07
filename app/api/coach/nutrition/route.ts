import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";

export async function GET(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const clientUserId = new URL(request.url).searchParams.get("client");
  if (!clientUserId) return privateJson({ error: "Client required" }, { status: 400 });
  const { data, error } = await client.rpc("nutrition_get_coach_view", { p_client_user_id: clientUserId });
  if (error) return privateJson({ error: error.code === "42501" ? "Nutrition access is unavailable for this client." : "Nutrition is temporarily unavailable." }, { status: error.code === "42501" ? 403 : 503 });
  return privateJson(data ?? { plan: null, checkins: [], feedback: [], canManage: false });
}

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const action = body.action === "activate" ? "activate" : body.action === "feedback" ? "feedback" : "draft";
  const params = action === "activate"
    ? { p_plan_id: typeof body.planId === "string" ? body.planId : null }
    : action === "feedback"
      ? { p_client_user_id: body.clientUserId, p_checkin_id: body.checkinId ?? null, p_message: body.message, p_client_visible: body.clientVisible !== false, p_private_note: body.privateNote === true }
      : { p_client_user_id: body.clientUserId, p_payload: body.payload ?? {}, p_plan_id: body.planId ?? null };
  const rpc = action === "activate" ? "nutrition_activate_plan" : action === "feedback" ? "nutrition_leave_feedback" : "nutrition_save_draft";
  const { data, error } = await client.rpc(rpc, params);
  if (error) return privateJson({ error: error.code === "42501" ? "Only the Primary PT can change this nutrition plan." : error.message.includes("draft") ? "Only a draft plan can be edited." : "That nutrition update could not be saved." }, { status: error.code === "42501" ? 403 : 400 });
  return privateJson(data ?? { status: "saved" });
}
