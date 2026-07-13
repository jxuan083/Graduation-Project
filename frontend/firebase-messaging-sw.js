// firebase-messaging-sw.js — 背景推播 service worker
// 必須放在 hosting 根目錄（scope 涵蓋整個站台），瀏覽器背景/分頁未開啟時的推播由這支處理。
// 前景（App 開著時）的推播改由 core/push.js 的 onMessage() 處理，不會走這裡。

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// 跟 core/config.js 的 firebaseConfig 保持一致（這些是公開的 client config，非機密金鑰）
firebase.initializeApp({
    apiKey: "AIzaSyBD_Q2H2H7HalmKV2A4TT1I2J9md9Mtq3k",
    authDomain: "graduation-6ae65.firebaseapp.com",
    projectId: "graduation-6ae65",
    storageBucket: "graduation-6ae65.firebasestorage.app",
    messagingSenderId: "798458690617",
    appId: "1:798458690617:web:bda0f994b531be1f4461e8",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || '社交定錨';
    const options = {
        body: payload.notification?.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: payload.data || {},
    };
    self.registration.showNotification(title, options);
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
