// core/push.js — 標準 Web Push 通知（VAPID，不依賴 Firebase）
// 流程：註冊 service worker → 跟使用者要權限 → PushManager 訂閱 → 存到後端 users/{uid}.push_subscriptions
// 前景（App 開著時）收到的推播不會跳系統通知，push-sw.js 會轉給頁面用 toast 顯示。

import { VAPID_PUBLIC_KEY } from './config.js';
import { apiFetch } from './api.js';
import { showToast } from '../utils/toast.js';
import { state } from './state.js';
import { t } from './i18n.js';

let foregroundListenerAdded = false;

function isPushSupported() {
    return 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
}

export function isPushAvailable() {
    return isPushSupported() && Boolean(VAPID_PUBLIC_KEY);
}

async function registerServiceWorker() {
    await navigator.serviceWorker.register('/push-sw.js');
    return navigator.serviceWorker.ready;
}

function vapidKeyBytes() {
    const base64 = (VAPID_PUBLIC_KEY + '='.repeat((4 - VAPID_PUBLIC_KEY.length % 4) % 4))
        .replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// 呼叫時機：使用者登入後，且在 UI 上主動點了「開啟通知」才呼叫（不要一進站就跳權限請求，體驗很差）
export async function enablePush() {
    if (!isPushSupported()) {
        showToast(t('這個瀏覽器不支援推播通知'), 'warn');
        return false;
    }
    if (!VAPID_PUBLIC_KEY) {
        console.warn('[push] VAPID_PUBLIC_KEY 未設定（core/config.js）');
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
        const subscription = await registration.pushManager.getSubscription()
            || await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: vapidKeyBytes(),
            });
        const token = JSON.stringify(subscription);

        await apiFetch('/api/push_token', {
            method: 'POST',
            body: JSON.stringify({ token }),
        });

        // 前景訊息：App 開著時不跳系統通知，用 toast 代替（避免跟系統通知重複又干擾）
        if (!foregroundListenerAdded) {
            foregroundListenerAdded = true;
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type !== 'push') return;
                const { title = '', body = '' } = event.data.payload || {};
                showToast(`${title} ${body}`.trim(), 'info');
            });
        }

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
