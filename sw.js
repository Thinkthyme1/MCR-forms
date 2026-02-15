/* manifest: app-v13 vendor-v1 */
const APP_PREFIX = "mcr-app-v";
const VENDOR_PREFIX = "mcr-vendor-v";
const MANIFEST_KEY = "__manifest__";

function resolve(path) {
  return new URL(path, self.registration.scope).toString();
}

/* ── Helpers ─────────────────────────────────────────────── */

async function fetchManifest() {
  const resp = await fetch(resolve("cache-manifest.json"), { cache: "no-store" });
  if (!resp.ok) throw new Error("manifest fetch failed");
  return resp.json();
}

async function getStoredManifest() {
  for (const name of await caches.keys()) {
    if (!name.startsWith(APP_PREFIX)) continue;
    const resp = await (await caches.open(name)).match(MANIFEST_KEY);
    if (resp) return resp.json();
  }
  return null;
}

async function findCache(prefix) {
  const keys = await caches.keys();
  return keys.find((k) => k.startsWith(prefix)) || null;
}

/* Copy a cached response from one cache to another by URL.
   Returns true if successful. */
async function copyEntry(srcName, destCache, url) {
  if (!srcName) return false;
  const src = await caches.open(srcName);
  const resp = await src.match(url);
  if (!resp) return false;
  await destCache.put(url, resp);
  return true;
}

/* ── Install ─────────────────────────────────────────────── */

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const manifest = await fetchManifest();
    const oldManifest = await getStoredManifest();

    const appCacheName = APP_PREFIX + manifest.appVersion;
    const vendorCacheName = VENDOR_PREFIX + manifest.vendorVersion;

    const oldApp = await findCache(APP_PREFIX);
    const oldVendor = await findCache(VENDOR_PREFIX);

    const appCache = await caches.open(appCacheName);
    const vendorCache = await caches.open(vendorCacheName);

    const oldAppHashes = oldManifest?.app?.files || {};
    const oldVendorHashes = oldManifest?.vendor?.files || {};

    // ── Vendor files (large, rarely change) ──
    for (const [file, hash] of Object.entries(manifest.vendor.files)) {
      const url = resolve(file);
      if (oldVendorHashes[file] === hash && await copyEntry(oldVendor, vendorCache, url)) continue;
      await vendorCache.add(url);
    }

    // ── App files (small, change often) ──
    for (const [file, hash] of Object.entries(manifest.app.files)) {
      const url = resolve(file);
      if (oldAppHashes[file] === hash && await copyEntry(oldApp, appCache, url)) continue;
      await appCache.add(url);
    }

    // Also cache "./" → index.html for root navigation
    const rootUrl = resolve("./");
    const indexUrl = resolve("index.html");
    const indexResp = await appCache.match(indexUrl);
    if (indexResp) await appCache.put(rootUrl, indexResp.clone());

    // Store manifest for future delta comparisons
    await appCache.put(
      MANIFEST_KEY,
      new Response(JSON.stringify(manifest), {
        headers: { "Content-Type": "application/json" }
      })
    );

    await self.skipWaiting();
  })());
});

/* ── Activate ────────────────────────────────────────────── */

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const manifest = await getStoredManifest();
    if (manifest) {
      const keep = new Set([
        APP_PREFIX + manifest.appVersion,
        VENDOR_PREFIX + manifest.vendorVersion
      ]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

/* ── Fetch ───────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(new Response("", { status: 204 }));
    return;
  }

  event.respondWith((async () => {
    // Check all caches (vendor + app — only 2 entries)
    for (const name of await caches.keys()) {
      const hit = await (await caches.open(name)).match(event.request);
      if (hit) return hit;
    }
    // Fallback to network — only cache valid responses
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const appName = await findCache(APP_PREFIX);
        if (appName) {
          const cache = await caches.open(appName);
          cache.put(event.request, response.clone());
        }
      }
      return response;
    } catch {
      return new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" }
      });
    }
  })());
});

/* ── Messages from main thread ───────────────────────────── */

self.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "GET_CRITICAL_STATUS") return;

  const manifest = await getStoredManifest();
  if (!manifest) {
    event.ports[0]?.postMessage({ statuses: [] });
    return;
  }

  const allFiles = [
    ...Object.keys(manifest.app.files),
    ...Object.keys(manifest.vendor.files)
  ];
  const cacheNames = await caches.keys();
  const statuses = [];

  for (const asset of allFiles) {
    const url = resolve(asset);
    let cached = false;
    for (const name of cacheNames) {
      if (await (await caches.open(name)).match(url)) { cached = true; break; }
    }
    statuses.push({ asset, cached });
  }

  event.ports[0]?.postMessage({ statuses });
});
