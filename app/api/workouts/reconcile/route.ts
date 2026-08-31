import { NextResponse } from "next/server";
import { authenticatedServerClient } from "@/lib/require-user";
import { reconcileMondayWorkout } from "@/lib/workout-repository";
import { reconstructVerifiedMonday } from "@/lib/workout-recovery";
import type { Workout } from "@/lib/types";

export async function POST(request: Request) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const candidate = await request.json().catch(() => null) as Workout | null;
  if (!candidate?.id || !candidate.name || !Array.isArray(candidate.sets)) return NextResponse.json({ error: "Invalid recovery candidate" }, { status: 400 });
  try {
    const result = await reconcileMondayWorkout(client, user.id, reconstructVerifiedMonday(candidate));
    return NextResponse.json(result);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const status = code === "GENUINE_SESSION_EXISTS" ? 409 : code === "INVALID_RECOVERY_CANDIDATE" ? 400 : 500;
    return NextResponse.json({ error: status === 409 ? "A genuine Monday session already exists; no changes were made." : "Recovery could not be completed.", code }, { status });
  }
}
