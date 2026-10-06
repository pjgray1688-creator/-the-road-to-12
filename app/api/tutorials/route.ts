import { serverSupabase } from "@/lib/supabase-server";
import { privateJson } from "@/lib/private-response";
import { tutorialVersion, type TutorialKey } from "@/lib/tutorials";

const keys: TutorialKey[] = ["member_core", "madhouse_connected", "coach_core"];

export async function GET() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await supabase.rpc("r12_get_my_tutorial_context");
  if (error) return privateJson({ error: "Tutorial state unavailable" }, { status: 503 });
  return privateJson(data ?? { member_ready: false, madhouse_connected: false, coach_ready: false, progress: [] });
}

export async function POST(request: Request) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})); const tutorialKey = body.tutorialKey as TutorialKey; const status = body.status;
  if (!keys.includes(tutorialKey) || !["completed", "skipped"].includes(status)) return privateJson({ error: "Invalid tutorial update" }, { status: 400 });
  const { data, error } = await supabase.rpc("r12_save_my_tutorial_progress", { p_tutorial_key: tutorialKey, p_version: tutorialVersion(tutorialKey), p_status: status });
  if (error) return privateJson({ error: "Tutorial progress could not be saved" }, { status: error.code === "42501" ? 403 : 500 });
  return privateJson({ progress: data });
}
