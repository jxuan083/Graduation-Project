// core/localNotify.js — 本地通知（Capacitor LocalNotifications）封裝，桌機 / web / 未裝 plugin 自動 no-op。
//
// 目前用途：意圖暫離「時間到」提醒。宣告意圖取得暫離窗口後，排一則「到期」通知，
// 窗口夠長時再多排一則「到期前」提醒；回到 App 或時間到就取消，避免殘留。
// 到期通知上有兩個按鈕：「延長一次」（不必打開 App）與「提前離開」。
// 安全網：非原生環境 getPlugin() 回 null，所有函式安靜略過，不影響既有流程。

import { t } from './i18n.js';

const INTENT_END_ID = 8801;    // 到期通知
const INTENT_WARN_ID = 8802;   // 到期前提醒
const ORDER_REMIND_ID = 8811;  // 帶出點餐：還在點餐嗎？
const ORDER_END_ID = 8812;     // 帶出點餐：時間到，開始算分心
const OPEN_WARN_ID = 8821;     // 老師限時開放：剩 1 分鐘
const OPEN_END_ID = 8822;      // 老師限時開放：時間到
const STUDY_BASE_ID = 8840;    // 讀書會番茄鐘：接下來幾次休息的開始與結束（8840～8847）
const STUDY_SLOTS = 4;
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
            ? t('回到 App 繼續專心，超過就會被算成分心。還需要時間可以延長一次（會用掉一次暫離），或提前離開聚會。')
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

// 帶出 App 點餐：remindSec 後問「還在點餐嗎？」，windowSec 後提醒「開始算分心」。回到 App 就取消。
export async function scheduleOrderReminders(remindSec, windowSec) {
    const plugin = getPlugin();
    if (!plugin || !(windowSec > 0)) return false;
    const granted = await ensureNotifyPermission();
    if (!granted) return false;
    await cancelOrderReminders();
    const now = Date.now();
    const notifications = [{
        id: ORDER_END_ID,
        title: t('點餐時間到了'),
        body: t('現在開始會算分心，回到 App 繼續聚會吧。'),
        schedule: { at: new Date(now + windowSec * 1000) },
    }];
    if (remindSec > 0 && remindSec < windowSec) {
        const left = Math.round((windowSec - remindSec) / 60);
        notifications.push({
            id: ORDER_REMIND_ID,
            title: t('還在點餐嗎？'),
            body: t('再 {n} 分鐘沒回到 App，就會開始算分心。', { n: left }),
            schedule: { at: new Date(now + remindSec * 1000) },
        });
    }
    try {
        await plugin.schedule({ notifications });
        return true;
    } catch (_) {
        return false;
    }
}

export async function cancelOrderReminders() {
    const plugin = getPlugin();
    if (!plugin) return;
    try {
        await plugin.cancel({ notifications: [{ id: ORDER_REMIND_ID }, { id: ORDER_END_ID }] });
    } catch (_) { /* noop */ }
}

// 老師限時開放使用手機、旅行休息滿 30 分鐘：結束前 1 分鐘提醒、結束時通知（結束時間事先知道，手機自己排）。
// variant：'class'／'meeting'／'rest'。同一次只排一次；開放結束、聚會結束時取消。
let _openScheduledFor = 0;
export async function schedulePhoneOpenEnd(untilMs, variant) {
    const plugin = getPlugin();
    if (!plugin || !(untilMs > Date.now()) || _openScheduledFor === untilMs) return false;
    const granted = await ensureNotifyPermission();
    if (!granted) return false;
    _openScheduledFor = untilMs;
    const isRest = variant === 'rest' || variant === 'rest-date';
    const notifications = [{
        id: OPEN_END_ID,
        title: isRest ? t('休息時間到了') : t('開放時間結束'),
        body: variant === 'rest-date' ? t('5 分鐘的休息結束了，回到 App 吧，現在離開會開始算分心。')
            : isRest ? t('已經休息 30 分鐘了，回到 App 吧，現在離開會開始算分心。')
            : variant === 'class' ? t('回到課堂吧，現在離開 App 會開始算分心。') : t('回到聚會吧，現在離開 App 會開始算分心。'),
        schedule: { at: new Date(untilMs) },
    }];
    if (untilMs - Date.now() > 2 * 60 * 1000) {
        notifications.push({
            id: OPEN_WARN_ID,
            title: isRest ? t('休息時間剩 1 分鐘') : t('開放時間剩 1 分鐘'),
            body: t('時間到之前回到 App 就好。'),
            schedule: { at: new Date(untilMs - 60 * 1000) },
        });
    }
    try {
        await plugin.schedule({ notifications });
        return true;
    } catch (_) {
        _openScheduledFor = 0;
        return false;
    }
}

export async function cancelPhoneOpenNotifications() {
    _openScheduledFor = 0;
    const plugin = getPlugin();
    if (!plugin) return;
    try {
        await plugin.cancel({ notifications: [{ id: OPEN_WARN_ID }, { id: OPEN_END_ID }] });
    } catch (_) { /* noop */ }
}

// 讀書會番茄鐘：先排好接下來幾次「休息開始」「休息結束」的通知（時間固定，手機自己排；回到 App 時再重排）。
let _studyKey = '';
export async function scheduleStudyBreaks(breaks) {
    const plugin = getPlugin();
    if (!plugin || !Array.isArray(breaks) || !breaks.length) return false;
    const key = breaks.map(b => b.start).join(',') + ':' + state_lang();
    if (key === _studyKey) return true;
    const granted = await ensureNotifyPermission();
    if (!granted) return false;
    await cancelStudyBreaks();
    _studyKey = key;
    const now = Date.now();
    const notifications = [];
    breaks.slice(0, STUDY_SLOTS).forEach((b, i) => {
        if (b.start > now) notifications.push({
            id: STUDY_BASE_ID + i * 2,
            title: t('番茄鐘休息時間'),
            body: t('休息 5 分鐘，可以用手機，也可以一起看看問題板。'),
            schedule: { at: new Date(b.start) },
        });
        if (b.end > now) notifications.push({
            id: STUDY_BASE_ID + i * 2 + 1,
            title: t('休息結束，繼續讀書'),
            body: t('回到 App 吧，現在離開會開始算分心。'),
            schedule: { at: new Date(b.end) },
        });
    });
    try {
        if (notifications.length) await plugin.schedule({ notifications });
        return true;
    } catch (_) {
        _studyKey = '';
        return false;
    }
}

export async function cancelStudyBreaks() {
    _studyKey = '';
    const plugin = getPlugin();
    if (!plugin) return;
    const ids = Array.from({ length: STUDY_SLOTS * 2 }, (_, i) => ({ id: STUDY_BASE_ID + i }));
    try { await plugin.cancel({ notifications: ids }); } catch (_) { /* noop */ }
}

function state_lang() {
    try { return localStorage.getItem('phubbing_lang') || 'zh'; } catch (_) { return 'zh'; }
}
