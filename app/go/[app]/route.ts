import { APP_DOWNLOAD_LINKS, detectDownloadPlatform, isAppDownloadSlug } from "@/lib/app-download-links";

type RouteContext = { params: Promise<{ app: string }> };

const privateResponseHeaders = { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" };

export async function GET(request: Request, { params }: RouteContext) {
  const { app: slug } = await params;
  if (!isAppDownloadSlug(slug)) {
    return new Response("Not found", { status: 404, headers: { ...privateResponseHeaders, "content-type": "text/plain; charset=utf-8" } });
  }

  const app = APP_DOWNLOAD_LINKS[slug];
  const platform = detectDownloadPlatform(request.headers.get("user-agent"));
  const destination = platform === "ios" ? app.apple : platform === "android" ? app.googlePlay : null;

  if (destination) {
    return new Response(null, { status: 307, headers: { ...privateResponseHeaders, location: destination } });
  }

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Get ${app.name} | R12</title><style>
    *{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 5%,rgba(153,32,190,.18),transparent 45%),#08090c;color:#f7f7fa;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(100%,460px);padding:clamp(26px,6vw,42px);border:1px solid rgba(172,76,219,.42);border-radius:22px;background:linear-gradient(145deg,#18181e,#0c0c10);box-shadow:0 24px 80px #0008}.brand{color:#d995f1;font-size:13px;font-weight:900;letter-spacing:.18em}.brand b{display:block;margin-bottom:20px;color:#fff;font-size:26px;letter-spacing:-.08em}.card h1{margin:0;font-size:clamp(28px,8vw,38px);line-height:1.1;letter-spacing:-.04em}.choices{display:grid;gap:12px;margin-top:26px}.choices a{min-height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border:1px solid #4a3c50;border-radius:12px;background:#151319;color:#fff;font-weight:800;text-decoration:none}.choices a:hover,.choices a:focus-visible{border-color:#c27bdd;outline:none}.choices span{color:#cf8bea;font-size:20px}
  </style></head><body><main class="card"><div class="brand"><b>R12</b>APP DOWNLOAD</div><h1>Get ${app.name}</h1><nav class="choices" aria-label="Choose an app store"><a href="${app.apple}">Apple App Store <span aria-hidden="true">↗</span></a><a href="${app.googlePlay}">Google Play <span aria-hidden="true">↗</span></a></nav></main></body></html>`;

  return new Response(html, { status: 200, headers: { ...privateResponseHeaders, "content-type": "text/html; charset=utf-8" } });
}
