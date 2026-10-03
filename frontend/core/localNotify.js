// core/localNotify.js — 本地通知（Capacitor LocalNotifications）封裝，桌機 / web / 未裝 plugin 自動 no-op。
//
// 目前用途：意圖暫離「時間到」提醒。宣告意圖取得暫離窗口後，排一則「到期」通知，
// 窗口夠長時再多排一則「到期前」提醒；回到 App 或時間到就取消，避免殘留。
// 到期通知上有兩個按鈕：「延長一次」（不必打開 App）與「提前離開」。
// 安全網：非原生環境 getPlugin() 回 null，所有函式安靜略過，不影響既有流程。

import { t } from './i18n.js';

const INTENT_END_ID = 8801;    // 到期通知
const INTENT_WARN_ID = 8802;   // 到期前提醒
const WARN_LEAD_SEC = 20;      // 到期前幾秒先提醒

// 通知按鈕組：一般到期通知可延長或離開；已延長過的只剩離開
const ACTION_TYPE_TIMEOUT = 'INTENT_TIMEOUT';
const ACTION_TYPE_TIMEOUT_NO_EXTEND = 'INTENT_TIMEOUT_NO_EXTEND';
const ACTION_EXTEND = 'extend';
const ACTION_LEAVE = 'leave';

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

// 註冊到期通知的按鈕，並把使用者按下的動作交給 handlers.extend / handlers.leave。
// 整個 App 只需呼叫一次（focus view 初始化時）。
export async function initIntentActions(handlers = {}) {
    const plugin = getPlugin();
    if (!plugin) return false;
    const leave = { id: ACTION_LEAVE, title: t('提前離開'), destructive: true, foreground: true };
    try {
        await plugin.registerActionTypes?.({
            types: [
                { id: ACTION_TYPE_TIMEOUT, actions: [{ id: ACTION_EXTEND, title: t('延長一次') }, leave] },
                { id: ACTION_TYPE_TIMEOUT_NO_EXTEND, actions: [leave] },
            ],
        });
        await plugin.addListener?.('localNotificationActionPerformed', (event) => {
            if (event?.notification?.id !== INTENT_END_ID) return;
            if (event.actionId === ACTION_EXTEND) handlers.extend?.();
            else if (event.actionId === ACTION_LEAVE) handlers.leave?.();
        });
        return true;
    } catch (_) {
        return false;
    }
}

// 依暫離窗口秒數排通知：到期一則；窗口夠長時，另排到期前 WARN_LEAD_SEC 秒的提醒。
// allowExtend=false 用在已延長過的那一輪（到期通知只剩「提前離開」）。
// 回傳是否成功排入（未授權 / 非原生 → false）。
export async function scheduleIntentEnd(windowSec, { allowExtend = true } = {}) {
    const plugin = getPlugin();
    if (!plugin || !(windowSec > 0)) return false;
    const granted = await ensureNotifyPermission();
    if (!granted) return false;

    await cancelIntentNotifications();  // 保險：清掉上一輪殘留

    const now = Date.now();
    const notifications = [{
        id: INTENT_END_ID,
        title: t('暫離時間到'),
        body: allowExtend
            ? t('回到 App 繼續專心，超過就會被算成分心。還需要時間可以延長一次，或提前離開聚會。')
            : t('延長的時間到了。回到 App 繼續專心，或提前離開聚會。'),
        schedule: { at: new Date(now + windowSec * 1000) },
        actionTypeId: allowExtend ? ACTION_TYPE_TIMEOUT : ACTION_TYPE_TIMEOUT_NO_EXTEND,
    }];
    if (windowSec > WARN_LEAD_SEC + 10) {
        notifications.push({
            id: INTENT_WARN_ID,
            title: t('暫離快結束了'),
            body: t('還有約 {n} 秒，準備回到聚會吧。', { n: WARN_LEAD_SEC }),
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
