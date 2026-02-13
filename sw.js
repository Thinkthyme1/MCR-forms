const CACHE_NAME = "mcr-forms-cache-v1";
const CRITICAL_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "src/main.js",
  "src/constants.js",
  "src/state.js",
  "src/db.js",
  "src/crypto.js",
  "src/signature-pad.js",
  "src/pdf.js",
  "src/ui.js"
];

function resolveAsset(path) {
  return new URL(path, self.registration.scope).toString();
}

const RESOLVED_CRITICAL_ASSETS = CRITICAL_ASSETS.map(resolveAsset);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(RESOLVED_CRITICAL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(new Response("", { status: 204 }));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }));
    })
  );
});

self.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "GET_CRITICAL_STATUS") return;
  const cache = await caches.open(CACHE_NAME);
  const statuses = await Promise.all(
    RESOLVED_CRITICAL_ASSETS.map((asset) => cache.match(asset).then((hit) => ({ asset, cached: !!hit })))
  );
  event.ports[0]?.postMessage({ statuses });
});
