import { NextResponse } from "next/server";
import { authenticatedServerClient } from "@/lib/require-user";
import { upsertWorkoutCardio } from "@/lib/workout-repository";
import type { Cardio } from "@/lib/types";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params; const cardio = await request.json().catch(() => null) as Cardio | null;
  if (!cardio || typeof cardio.duration !== "number") return NextResponse.json({ error: "Invalid cardio" }, { status: 400 });
  try { return NextResponse.json({ cardio: await upsertWorkoutCardio(client, user.id, id, cardio) }); }
  catch { return NextResponse.json({ error: "Unable to save cardio" }, { status: 500 }); }
}
