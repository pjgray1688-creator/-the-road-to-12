import { manifestResponse } from "@/lib/android-apps";

export function GET() {
  return manifestResponse("club");
}
