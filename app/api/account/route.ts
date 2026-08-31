import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";
import { siteUrl } from "@/lib/site-url";

const profileFields = "display_name,first_name,last_name,timezone,step_goal,created_at";
function persistenceError(operation: string, error: { code?: string; message?: string }) { console.error("[account] profile persistence failed", { operation, table: "public.profiles", code: error.code, message: error.message }); }
function diagnosticCode(error: { code?: string; message?: string }, operation: "update" | "upsert") { const message = (error.message ?? "").toLowerCase(); if (message.includes("row-level security") || message.includes("rls")) return "profile_rls_violation"; if (error.code === "42501" || message.includes("permission denied")) return "profile_permission_denied"; if (error.code === "42703" || message.includes("column") && message.includes("does not exist")) return "profile_missing_column"; return `profile_${operation}_failed`; }

export async function GET() {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const timezone = user.user_metadata?.timezone || "Europe/London"; const firstName = user.user_metadata?.first_name || ""; const lastName = user.user_metadata?.last_name || ""; const displayName = user.user_metadata?.display_name || user.user_metadata?.full_name || "";
  const { error: ensureError } = await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? "", display_name: displayName, first_name: firstName, last_name: lastName, timezone, step_goal: 10000 }, { onConflict: "id", ignoreDuplicates: true });
  if (ensureError) persistenceError("profile_initialization", ensureError);
  const { data: profile, error } = await supabase.from("profiles").select(profileFields).eq("id", user.id).maybeSingle();
  if (error) persistenceError("profile_read", error);
  return NextResponse.json({ id: user.id, email: user.email, profile, siteUrl: siteUrl() });
}

export async function POST(request: Request) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})); const firstName = typeof body.first_name === "string" ? body.first_name.trim().slice(0, 80) : ""; const lastName = typeof body.last_name === "string" ? body.last_name.trim().slice(0, 80) : ""; const displayName = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 80) : [firstName, lastName].filter(Boolean).join(" ");
  const { data: profile, error } = await supabase.from("profiles").update({ first_name: firstName, last_name: lastName, display_name: displayName }).eq("id", user.id).select(profileFields).maybeSingle();
  if (error) { persistenceError("profile_update", error); return NextResponse.json({ error: "Profile could not be updated", code: diagnosticCode(error, "update") }, { status: 500 }); }
  if (profile) return NextResponse.json({ profile });
  const { data: inserted, error: insertError } = await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? "", first_name: firstName, last_name: lastName, display_name: displayName, timezone: user.user_metadata?.timezone || "Europe/London", step_goal: 10000 }, { onConflict: "id" }).select(profileFields).single();
  if (insertError) { persistenceError("profile_upsert", insertError); return NextResponse.json({ error: "Profile could not be updated", code: diagnosticCode(insertError, "upsert") }, { status: 500 }); }
  return NextResponse.json({ profile: inserted });
}
