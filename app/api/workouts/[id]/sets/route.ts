import { NextResponse } from "next/server";
import { authenticatedServerClient } from "@/lib/require-user";
import { upsertWorkoutSet } from "@/lib/workout-repository";
import type { LoggedSet } from "@/lib/types";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient(); if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params; const body = await request.json().catch(() => null) as { set?: LoggedSet; setOrder?: number } | null;
  if (!body?.set?.id) return NextResponse.json({ error: "Invalid set" }, { status: 400 });
  try { return NextResponse.json({ set: await upsertWorkoutSet(client, user.id, id, body.set, body.setOrder ?? 0) }); }
  catch { return NextResponse.json({ error: "Unable to save set" }, { status: 500 }); }
}
