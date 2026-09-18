/* Surf AI — keep the site usable offline, like YouTube with saved videos. */
const CACHE = "surf-shell-v3";
const PRECACHE = [
  "/",
  "/index.html",
  "/chat",
  "/chat.html",
  "/host",
  "/host.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.png",
  "/apple-icon.png",
  "/surf.png",
  "/local-agent.html",
  "/LOCAL-SETUP.sh",
  "/LOCAL-SETUP.bat",
  "/system.md",
  "/web-llm.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isLocalDevNoise(url) {
  return (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.includes("hot-update") ||
    url.pathname.startsWith("/__nextjs")
  );
}

async function cachedPage(path) {
  const cache = await caches.open(CACHE);
  const tries = [
    path,
    path.endsWith("/") ? `${path}index.html` : `${path}.html`,
    `${path.replace(/\/$/, "")}/index.html`,
    "/chat.html",
    "/chat",
    "/index.html",
    "/",
  ];
  for (const t of tries) {
    const hit = await cache.match(t, { ignoreSearch: true });
    if (hit) return hit;
  }
  return undefined;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  if (isLocalDevNoise(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          await cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        if (cached) return cached;
        if (req.mode === "navigate") {
          const page = await cachedPage(url.pathname);
          if (page) return page;
        }
        const asHtml = await cache.match(`${url.pathname}.html`, { ignoreSearch: true });
        if (asHtml) return asHtml;
        throw err;
      }
    })(),
  );
});
