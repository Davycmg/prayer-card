// share.html（存到 PUSH）的 service worker：只為了讓 Android Chrome 認得它是可安裝的 App、
// 出現在分享選單裡。不做快取，所有請求照常走網路。scope 只限 share.html，不影響其他頁面。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
