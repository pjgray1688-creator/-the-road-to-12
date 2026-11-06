export const dynamic = "force-dynamic";
import { ANDROID_APPS, androidAssetLinks } from "@/lib/android-apps";

export async function GET() {
  const statements = androidAssetLinks(process.env.R12_ANDROID_APP_LINKS_JSON);
  const configured = statements.length === Object.keys(ANDROID_APPS).length;
  return Response.json(statements, {
    status: configured ? 200 : 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": configured ? "public, max-age=300, s-maxage=300" : "no-store",
    },
  });
}
