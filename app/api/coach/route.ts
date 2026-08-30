import { NextResponse } from "next/server";
import { evaluateSet } from "@/lib/coach";

export async function POST(request: Request) {
  // This is the server boundary where a secure AI coach can later augment the local engine.
  const body = await request.json();
  return NextResponse.json(evaluateSet(body.exercise, body.loggedSets, body.feedback, body.previousSets));
}
