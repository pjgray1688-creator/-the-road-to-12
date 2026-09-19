import { privateJson } from "@/lib/private-response";
import { authenticatedServerClient } from "@/lib/require-user";
import { deleteWorkoutSet, upsertWorkoutSet } from "@/lib/workout-repository";
import type { LoggedSet } from "@/lib/types";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params; const body = await request.json().catch(() => null) as { set?: LoggedSet; setOrder?: number } | null;
  if (!body?.set?.id) return privateJson({ error: "Invalid set" }, { status: 400 });
  try { return privateJson({ set: await upsertWorkoutSet(client, user.id, id, body.set, body.setOrder ?? 0) }); }
  catch { return privateJson({ error: "Unable to save set" }, { status: 500 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { client, user } = await authenticatedServerClient(); if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params; const setId = new URL(request.url).searchParams.get("setId");
  if (!setId) return privateJson({ error: "Invalid set" }, { status: 400 });
  try { return privateJson(await deleteWorkoutSet(client, user.id, id, setId)); } catch { return privateJson({ error: "Unable to delete set" }, { status: 500 }); }
}
