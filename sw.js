/* Service worker for 賭螺預測器 PWA. Bump VERSION on release. */
const VERSION = "v1";
const SHELL_CACHE = `conch-shell-${VERSION}`;
const RUNTIME_CACHE = `conch-runtime-${VERSION}`;
const RUNTIME_LIMIT = 60;

const BASE = new URL("./", self.location).href;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./records.html",
  "./styles.css?v=7",
  "./app.js?v=7",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./vendor/xlsx/xlsx.full.min.js"
];

const RUNTIME_ALLOW = [
  "vendor/opencv/",
  "vendor/tesseract/",
  "vendor/xlsx/"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith("conch-") && ![SHELL_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isRuntimeAllowed(url) {
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
  return RUNTIME_ALLOW.some((p) => path.startsWith(p));
}

async function cachePut(request, response) {
  if (!response || response.status !== 200 || response.type === "opaque") return;
  if (response.type !== "basic" && response.type !== "default") return;
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length >= RUNTIME_LIMIT) await cache.delete(keys[0]);
  await cache.put(request, response.clone());
}

async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    cachePut(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) return cached;
    const shell = await caches.match("./index.html");
    if (shell) return shell;
    throw err;
  }
}

async function handleAsset(request, url) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (isRuntimeAllowed(url)) cachePut(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
  } else {
    event.respondWith(handleAsset(request, url));
  }
});
