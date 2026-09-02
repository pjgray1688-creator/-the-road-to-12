import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";

type Metric = Record<string, unknown>;
const isMetric = (value: unknown): value is Metric => Boolean(value && typeof value === "object" && typeof (value as Metric).id === "string" && typeof (value as Metric).date === "string");

export async function GET() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await supabase.from("profiles").select("training_profile").eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Progress is unavailable" }, { status: 500 });
  const profile = data?.training_profile && typeof data.training_profile === "object" ? data.training_profile as Record<string, unknown> : {};
  return NextResponse.json({ bodyMetrics: Array.isArray(profile._progressBodyMetrics) ? profile._progressBodyMetrics.filter(isMetric) : [] });
}

export async function POST(request: Request) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.bodyMetrics) || body.bodyMetrics.some((item: unknown) => !isMetric(item))) return NextResponse.json({ error: "Invalid progress data" }, { status: 400 });
  const { data: current, error: readError } = await supabase.from("profiles").select("training_profile").eq("id", user.id).maybeSingle();
  if (readError) return NextResponse.json({ error: "Progress could not be saved" }, { status: 500 });
  const profile = current?.training_profile && typeof current.training_profile === "object" ? current.training_profile as Record<string, unknown> : {};
  const nextProfile = { ...profile, _progressBodyMetrics: body.bodyMetrics };
  const { error } = await supabase.from("profiles").update({ training_profile: nextProfile }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Progress could not be saved" }, { status: 500 });
  return NextResponse.json({ bodyMetrics: body.bodyMetrics });
}
