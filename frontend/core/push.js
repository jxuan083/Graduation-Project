// core/push.js — Web Push 通知（Firebase Cloud Messaging）
// 流程：註冊 service worker → 跟使用者要權限 → 拿 FCM token → 存到後端 users/{uid}.fcm_tokens
// 前景（App 開著時）收到的推播不會跳系統通知，改用 toast 顯示；背景推播由 firebase-messaging-sw.js 處理。

import { FCM_VAPID_KEY } from './config.js';
import { apiFetch } from './api.js';
import { showToast } from '../utils/toast.js';
import { state } from './state.js';
import { t } from './i18n.js';

let messaging = null;

function isPushSupported() {
    return 'serviceWorker' in navigator && 'Notification' in window && typeof firebase !== 'undefined' && !!firebase.messaging;
}

export function isPushAvailable() {
    return isPushSupported() && Boolean(FCM_VAPID_KEY);
}

async function registerServiceWorker() {
    return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

// 呼叫時機：使用者登入後，且在 UI 上主動點了「開啟通知」才呼叫（不要一進站就跳權限請求，體驗很差）
export async function enablePush() {
    if (!isPushSupported()) {
        showToast(t('這個瀏覽器不支援推播通知'), 'warn');
        return false;
    }
    if (!FCM_VAPID_KEY) {
        console.warn('[push] FCM_VAPID_KEY 未設定，去 Firebase Console → Cloud Messaging 產生後填入 core/config.js');
        showToast(t('推播通知尚未啟用'), 'warn');
        return false;
    }
    if (!state.currentUser) return false;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast(t('通知權限被拒絕，之後可以到瀏覽器設定重新開啟'), 'warn');
            return false;
        }

        const registration = await registerServiceWorker();
        if (!messaging) messaging = firebase.messaging();

        const token = await messaging.getToken({
            vapidKey: FCM_VAPID_KEY,
            serviceWorkerRegistration: registration,
        });
        if (!token) {
            showToast(t('無法取得推播 token'), 'warn');
            return false;
        }

        await apiFetch('/api/push_token', {
            method: 'POST',
            body: JSON.stringify({ token }),
        });

        // 前景訊息：App 開著時不跳系統通知，用 toast 代替（避免跟系統通知重複又干擾）
        messaging.onMessage((payload) => {
            const title = payload.notification?.title || '';
            const body = payload.notification?.body || '';
            showToast(`${title} ${body}`.trim(), 'info');
        });

        localStorage.setItem('pushEnabled', '1');
        showToast(t('通知已開啟'), 'success');
        return true;
    } catch (err) {
        console.error('[push] enablePush failed:', err);
        showToast(t('開啟通知失敗：') + (err.message || err), 'warn');
        return false;
    }
}

// boot 時呼叫：如果使用者之前已經同意過，靜默重新註冊 token（不會再跳權限請求）
export async function reEnablePushIfPreviouslyGranted() {
    if (!isPushSupported()) return;
    if (localStorage.getItem('pushEnabled') !== '1') return;
    if (Notification.permission !== 'granted') return;
    await enablePush();
}
