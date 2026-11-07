import { NextResponse } from "next/server";
import { MADHOUSE_JOINING_DESTINATION } from "@/lib/app-download-links";

export function GET() {
  return NextResponse.redirect(MADHOUSE_JOINING_DESTINATION, 302);
}
