const CACHE_NAME = 'prismamd-2026.11.17.1';
const CORE_PRECACHE_ASSETS = /*__CORE_PRECACHE_ASSETS__*/ [];
const LAZY_WARM_ASSETS = /*__LAZY_WARM_ASSETS__*/ [];

let warmingPromise = null;

async function warmLazyAssets() {
  if (!Array.isArray(LAZY_WARM_ASSETS) || LAZY_WARM_ASSETS.length === 0) return;
  const cache = await caches.open(CACHE_NAME);
  const concurrency = 4;
  let index = 0;

  async function worker() {
    while (index < LAZY_WARM_ASSETS.length) {
      const assetUrl = LAZY_WARM_ASSETS[index];
      index += 1;
      try {
        const existing = await cache.match(assetUrl, { ignoreSearch: true });
        if (!existing) {
          const response = await fetch(assetUrl);
          if (response && response.status === 200) {
            await cache.put(assetUrl, response);
          }
        }
      } catch {
        // Ignore transient offline/network failures while warming optional lazy assets
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, LAZY_WARM_ASSETS.length) }, () => worker()),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_PRECACHE_ASSETS))
      .then(() => {
        if (!self.registration.active) {
          return self.skipWaiting();
        }
        return undefined;
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'WARM_LAZY_ASSETS') {
    if (!warmingPromise) {
      warmingPromise = warmLazyAssets().finally(() => {
        warmingPromise = null;
      });
    }
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(warmingPromise);
    }
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json') || url.pathname === '/version.json') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cachedNav = await cache.match(event.request, { ignoreSearch: true });
          if (cachedNav) return cachedNav;
          const fallback = await cache.match('./index.html');
          return fallback || Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return Response.error();
      }
    }),
  );
});
