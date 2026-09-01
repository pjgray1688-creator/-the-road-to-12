import { NextResponse } from "next/server";
import { authenticatedServerClient } from "@/lib/require-user";
import { discardActiveWorkout } from "@/lib/workout-repository";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  try { return NextResponse.json(await discardActiveWorkout(client, user.id, id)); }
  catch (error) { const code = (error as { code?: string }).code ?? "DISCARD_FAILED"; if (code === "NOT_FOUND") return NextResponse.json({ discarded: id, alreadyAbsent: true }); return NextResponse.json({ error: "Unable to discard workout", code }, { status: code === "WORKOUT_NOT_ACTIVE" ? 409 : 500 }); }
}
