/**
 * Offline shell for the PWA.
 *
 * The app was installable but had no service worker at all, which meant that opening it
 * without a connection got a browser error page. That contradicted the resolver's whole
 * design: `unresolved` exists — and deliberately never blocks a log — because the lifter is
 * standing at a rack on bad gym wifi. None of that helps if the app itself will not boot.
 *
 * STRATEGY, and why each half is the way round it is:
 *
 * - Navigations (the HTML) are NETWORK-FIRST. This is the one that can ruin a deployed app:
 *   a cache-first shell pins whatever index.html the browser saw first, and every future
 *   deploy points at asset hashes that HTML has never heard of. Going to the network first
 *   means a working connection always sees the current build, and the cached copy is only
 *   ever a fallback for being offline.
 *
 * - Hashed build assets are CACHE-FIRST. Safe precisely because Vite puts a content hash in
 *   the filename: the bytes behind `/assets/index-ad-vqM2A.js` can never change, so a hit is
 *   always correct and a new build simply asks for a new name.
 *
 * NOT cached, ever: anything cross-origin. Supabase reads carry the lifter's auth and their
 * answers are per-user; the model calls cost money and must not be replayed. Only same-origin
 * GETs are touched here, so all of that falls straight through to the network untouched.
 */

// Bump to invalidate everything. Old caches are deleted on activate.
//
// v1 -> v2: v1 cached whatever a navigation returned, including error pages. On a host with
// no SPA rewrite that meant a deep link's 404 got stored AS the offline shell, so going
// offline served a 404 instead of the app. Bumping the version is what evicts that poisoned
// entry from clients that already have it — the fix below stops it happening again.
const VERSION = 'v2'
const SHELL = `strengthai-shell-${VERSION}`
const ASSETS = `strengthai-assets-${VERSION}`
const KEEP = [SHELL, ASSETS]

const SHELL_URL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(SHELL_URL))
      // A failed precache must not leave a worker that never activates; the fetch handler
      // repopulates the shell on the first successful navigation anyway.
      .catch(() => {})
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

/** Hashed build output — immutable by construction, so a cache hit is always current. */
const isBuildAsset = (url) => url.pathname.startsWith('/assets/')

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // ---- navigations: network first, cached shell as the offline fallback ----------------
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          // ONLY store a successful document. A fetch that resolves is not a fetch that
          // worked: a 404 or a 500 is a perfectly ordinary resolved Response, and caching one
          // here overwrites the offline shell with an error page — which is exactly what
          // happened in v1 against a host with no SPA rewrite.
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL).then((cache) => cache.put(SHELL_URL, copy))
            return response
          }

          // Non-ok navigation. In a SPA every path is the client router's to resolve, so a
          // cached shell is a better answer than the host's error page — this is what
          // `historyApiFallback` does in dev. Falls through to the real response when there
          // is no shell to serve, so a genuine failure is still visible.
          const shell = await caches.match(SHELL_URL)
          return shell ?? response
        })
        .catch(async () => {
          // Offline. Serve the shell and let the router take it from there — the SPA's own
          // routes resolve client-side, so any URL works once this boots.
          const cached = await caches.match(SHELL_URL)
          return cached ?? Response.error()
        })
    )
    return
  }

  // ---- hashed assets: cache first ------------------------------------------------------
  if (isBuildAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            // Opaque or failed responses are not worth storing — a cached error would
            // outlive the condition that caused it.
            if (response.ok) {
              const copy = response.clone()
              caches.open(ASSETS).then((cache) => cache.put(request, copy))
            }
            return response
          })
      )
    )
    return
  }

  // Everything else same-origin (icons, the manifest, the favicon): network, falling back to
  // whatever happens to be cached.
  event.respondWith(fetch(request).catch(() => caches.match(request).then((hit) => hit ?? Response.error())))
})
