const CACHE_NAME = 'codematrix-static-v1'

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-16x16.png',
]

const SHELL_URLS = new Set(SHELL_ASSETS)
const STATIC_PREFIXES = ['/assets/', '/icons/']
const DYNAMIC_PREFIXES = ['/api/', '/socket.io/', '/preview/']

function isDynamic(url) {
  return DYNAMIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

function isStatic(url) {
  return (
    SHELL_URLS.has(url.pathname) ||
    STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      ),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isDynamic(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        return (await cache.match('/index.html')) ?? (await cache.match('/')) ?? Response.error()
      }),
    )
    return
  }

  if (!isStatic(url)) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response && response.ok) cache.put(request, response.clone())
      return response
    }),
  )
})
