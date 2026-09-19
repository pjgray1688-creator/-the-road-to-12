const CACHE = "r12-shell-v4";

const STATIC_ASSET_PATHS = [
  /^\/_next\/static\/.+\.(?:css|js|map|woff2?|ttf|otf)$/,
  /^\/(?:icons|club-branding)\/[^/]+\.(?:ico|jpg|jpeg|png|svg|webp)$/,
  /^\/(?:apple-touch-icon|favicon-(?:32|48)|icon)\.(?:png|svg)$/,
  /^\/(?:manifest\.webmanifest|club\/manifest\.webmanifest)$/
];

const isPrivateResponse = response => {
  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  return cacheControl.includes("private") || cacheControl.includes("no-store");
};

const isDocumentResponse = response => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml") ||
    contentType.includes("text/x-component") ||
    response.headers.has("x-nextjs-data");
};

const isStaticAssetRequest = request => {
  const url = new URL(request.url);
  return request.method === "GET" &&
    url.origin === self.location.origin &&
    url.search === "" &&
    request.mode !== "navigate" &&
    request.destination !== "document" &&
    STATIC_ASSET_PATHS.some(path => path.test(url.pathname));
};

self.addEventListener("install", event => event.waitUntil(self.skipWaiting().then(() => caches.open(CACHE))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  const { request } = event;

  // Navigations and all non-allowlisted requests stay on the network. In
  // particular, no document or private application response gets a fallback.
  if (!isStaticAssetRequest(request)) return;

  event.respondWith(fetch(request).then(response => {
    if (response.ok && !isPrivateResponse(response) && !isDocumentResponse(response)) {
      const copy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request)));
});
