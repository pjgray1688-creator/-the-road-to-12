import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";

type State = { sessionStatusOverrides?: Record<string, unknown>; salvageAdjustments?: unknown[] };
const read = (value: unknown): State & Record<string, unknown> => value && typeof value === "object" ? value as State & Record<string, unknown> : {};
export async function GET() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await supabase.from("profiles").select("training_profile").eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Training state unavailable" }, { status: 500 });
  const profile = read(data?.training_profile); const state = read(profile._trainingState);
  return NextResponse.json({ sessionStatusOverrides: state.sessionStatusOverrides ?? {}, salvageAdjustments: state.salvageAdjustments ?? [] });
}
export async function POST(request: Request) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid training state" }, { status: 400 });
  const { data: current, error: readError } = await supabase.from("profiles").select("training_profile").eq("id", user.id).maybeSingle();
  if (readError) return NextResponse.json({ error: "Training state could not be saved" }, { status: 500 });
  const profile = read(current?.training_profile); const previous = read(profile._trainingState);
  const state = { sessionStatusOverrides: body.sessionStatusOverrides ?? previous.sessionStatusOverrides ?? {}, salvageAdjustments: body.salvageAdjustments ?? previous.salvageAdjustments ?? [] };
  const { error } = await supabase.from("profiles").update({ training_profile: { ...profile, _trainingState: state } }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Training state could not be saved" }, { status: 500 });
  return NextResponse.json(state);
}
