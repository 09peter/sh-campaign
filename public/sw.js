// Minimal service worker: cache-first for static assets, network for the rest.
// Writes and API calls are never intercepted — reads of stale campaign data
// beat a blank screen on the U-Bahn; stale writes would corrupt turns.
const CACHE = 'crusade-static-v1'
self.addEventListener('install', (e) => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  const isStatic = url.origin === location.origin &&
    (url.pathname.startsWith('/assets/') || /\.(svg|png|webmanifest|css|js)$/.test(url.pathname))
  if (e.request.method !== 'GET' || !isStatic) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request)
      const fetched = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone())
        return res
      }).catch(() => cached)
      return cached ?? fetched
    })
  )
})
