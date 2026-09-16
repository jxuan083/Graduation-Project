// core/localNotify.js — 本地通知（Capacitor LocalNotifications）封裝，桌機 / web / 未裝 plugin 自動 no-op。
//
// 目前用途：意圖暫離「時間到」提醒。宣告意圖取得暫離窗口後，排一則「到期」通知，
// 窗口夠長時再多排一則「到期前」提醒；回到 App 或時間到就取消，避免殘留。
// 安全網：非原生環境 getPlugin() 回 null，所有函式安靜略過，不影響既有流程。

const INTENT_END_ID = 8801;    // 到期通知
const INTENT_WARN_ID = 8802;   // 到期前提醒
const WARN_LEAD_SEC = 20;      // 到期前幾秒先提醒

function getPlugin() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
}

export function localNotifyAvailable() {
    return !!getPlugin();
}

let _permissionAsked = false;

// 確認 / 索取通知權限。已授權→true；已拒絕或使用者不給→false。整個 session 只主動問一次。
export async function ensureNotifyPermission() {
    const plugin = getPlugin();
    if (!plugin) return false;
    try {
        const cur = await plugin.checkPermissions?.();
        if (cur?.display === 'granted') return true;
        if (cur?.display === 'denied') return false;
        if (_permissionAsked) return false;
        _permissionAsked = true;
        const req = await plugin.requestPermissions?.();
        return req?.display === 'granted';
    } catch (_) {
        return false;
    }
}

// 依暫離窗口秒數排通知：到期一則；窗口夠長時，另排到期前 WARN_LEAD_SEC 秒的提醒。
// 回傳是否成功排入（未授權 / 非原生 → false）。
export async function scheduleIntentEnd(windowSec) {
    const plugin = getPlugin();
    if (!plugin || !(windowSec > 0)) return false;
    const granted = await ensureNotifyPermission();
    if (!granted) return false;

    await cancelIntentNotifications();  // 保險：清掉上一輪殘留

    const now = Date.now();
    const notifications = [{
        id: INTENT_END_ID,
        title: '暫離時間到',
        body: '回到 App 繼續專心，超過就會被算成分心囉。',
        schedule: { at: new Date(now + windowSec * 1000) },
    }];
    if (windowSec > WARN_LEAD_SEC + 10) {
        notifications.push({
            id: INTENT_WARN_ID,
            title: '暫離快結束了',
            body: `還有約 ${WARN_LEAD_SEC} 秒，準備回到聚會吧。`,
            schedule: { at: new Date(now + (windowSec - WARN_LEAD_SEC) * 1000) },
        });
    }
    try {
        await plugin.schedule({ notifications });
        return true;
    } catch (_) {
        return false;
    }
}

// 取消暫離相關的排程通知（回到 App / 時間到 / 聚會結束時呼叫）。
export async function cancelIntentNotifications() {
    const plugin = getPlugin();
    if (!plugin) return;
    try {
        await plugin.cancel({ notifications: [{ id: INTENT_END_ID }, { id: INTENT_WARN_ID }] });
    } catch (_) { /* noop */ }
}
