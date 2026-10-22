// push-sw.js — Web Push service worker
// 必須放在 hosting 根目錄（scope 涵蓋整個站台）。
// App 分頁在前景時不跳系統通知，改轉給頁面（core/push.js）用 toast 顯示。

self.addEventListener('push', (event) => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (_) {}
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            const focused = clientList.find((client) => client.focused);
            if (focused) {
                focused.postMessage({ type: 'push', payload });
                return;
            }
            return self.registration.showNotification(payload.title || '社交定錨', {
                body: payload.body || '',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                data: { url: payload.url || '/' },
            });
        })
    );
});

// 點通知 → 開啟（或聚焦既有）App 分頁
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = self.location.origin + (event.notification.data?.url || '/');
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
