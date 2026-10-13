/* 离线缓存：页面本身和图标存一份在浏览器里，断网时也能打开。
   GitHub 等外部请求一律直连，不经过这里。更新页面后，联网打开一次就会用上新版本。 */
const CACHE = 'xiangmu-tuijin-2026-10-12j';
const SHELL = ['./', './index.html', './editor.js?v=2026-10-12j', './math.js?v=2026-10-12j', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const PATHS = SHELL.map(u => u.slice(1).split('?')[0]).filter(Boolean);           // 只缓存这些文件

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))      // 少传了某个图标也不影响安装
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('xiangmu-tuijin-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {                                    // 页面：先联网取最新版，断网时用缓存
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
      return res;
    }).catch(() => caches.match('./index.html').then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && PATHS.some(p => url.pathname.endsWith(p))) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
