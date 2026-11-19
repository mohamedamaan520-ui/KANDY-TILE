/* KANDY TILE service worker. Network-first keeps the live catalogue and cloud sync current. */
const APP_CACHE = 'kandy-tile-shell-v1';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('kandy-tile-') && key !== APP_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => new Response(
      '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>KANDY TILE</title><body style="font-family:Arial;text-align:center;padding:48px 20px;background:#071c29;color:white"><h1>KANDY TILE</h1><p>Internet connection is unavailable. Please reconnect and reload to view the latest catalogue.</p></body></html>',
      {headers:{'Content-Type':'text/html; charset=utf-8'}}
    )));
  }
});
