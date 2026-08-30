import { NextResponse } from "next/server";
import { getSetRecommendation } from "@/lib/coach";

export async function POST(request: Request) {
  // This is the server boundary where a secure AI coach can later augment the local engine.
  const body = await request.json();
  return NextResponse.json(getSetRecommendation(body));
}
