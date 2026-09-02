const CACHE = "r12-shell-v2";
self.addEventListener("install", event => event.waitUntil(self.skipWaiting().then(() => caches.open(CACHE).then(cache => cache.addAll(["/"]))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => { if (event.request.method !== "GET") return; event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request))); });
self.addEventListener("fetch", event => { if (event.request.method === "GET") event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request))); });
