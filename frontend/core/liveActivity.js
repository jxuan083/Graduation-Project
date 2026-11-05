// core/liveActivity.js — 靈動島／鎖定畫面倒數（iOS 16.2+ 即時動態）
//
// 畫面寫在原生的 AnchorLiveActivity 擴充功能，這裡只決定什麼時候開始、更新、結束：
//   暫離倒數：按下暫離時開始（App 在前景），延長時更新，回到 App 或提前結束就收掉。
//   寬限倒數：沒暫離就直接跳出 App 時「還有幾秒會算分心」。iOS 只允許在前景開始即時動態，
//     跳出那一刻前端已經來不及呼叫，所以這裡只負責「預備」：聚會進行中、沒在暫離、
//     沒在拍照時先告訴原生，真正開始由原生在 App 即將離開前景時做。
// 網頁、舊版 iOS、或原生還沒有這些方法時全部安靜略過，不影響原本的流程。
import { state } from './state.js';
import { t } from './i18n.js';

async function invoke(method, args = {}) {
    const plugin = window.Capacitor?.Plugins?.LockState;
    if (!plugin || typeof plugin[method] !== 'function') return null;
    try {
        return await plugin[method](args);
    } catch (_) {
        return null;
    }
}

export function startBreakCountdown(endsAtMs) {
    return invoke('startCountdown', {
        kind: 'break',
        endsAt: endsAtMs,
        title: t('暫離中'),
        hint: t('回到 App 就會結束暫離'),
        overTitle: t('暫離超時'),
        overHint: t('超過 5 分鐘會自動離開聚會'),
        appName: t('社交定錨'),
    });
}

// 帶出 App 點餐：靈動島顯示「點餐中」，刻意不顯示時間；remindSec 後（系統重畫時）換成「還在點餐嗎？」
export function startOrderActivity(remindSec) {
    return invoke('startCountdown', {
        kind: 'order',
        endsAt: Date.now() + remindSec * 1000,
        title: t('點餐中'),
        hint: t('點完回到 App 就好'),
        overTitle: t('還在點餐嗎？'),
        overHint: t('再 5 分鐘沒回到 App，就會開始算分心'),
        appName: t('社交定錨'),
    });
}

export function extendBreakCountdown(endsAtMs) {
    return invoke('updateCountdown', { endsAt: endsAtMs });
}

export function endCountdown() {
    return invoke('endCountdown');
}

// 只在狀態真的改變時才通知原生（呼叫端每秒同步一次）
let _graceKey = '';

// open：主持人開放使用手機中 → 跳出 App 時改顯示開放狀態（見 phoneOpenActivity），不是寬限倒數。
export function setGraceCountdown(armed, graceMs, open = null) {
    const key = armed ? `on:${graceMs}:${state.lang}:${open ? `${open.kind}:${open.endsAt}` : 'grace'}` : 'off';
    if (key === _graceKey) return;
    _graceKey = key;
    const labels = open ? open.labels : {
        title: t('快回到聚會'),
        hint: t('倒數結束前回到 App 就不算分心'),
        overTitle: t('分心中'),
        overHint: t('回到 App 就停止計算'),
    };
    invoke('setGraceCountdown', {
        armed,
        graceSec: Math.round(graceMs / 1000),
        ...(open ? { kind: open.kind, endsAt: open.endsAt } : {}),
        ...labels,
        appName: t('社交定錨'),
    });
}

// 讀書會番茄鐘休息中跳出 App：倒數到休息結束
export function studyBreakActivity(breakEndMs) {
    return {
        kind: 'open_timed',
        endsAt: breakEndMs,
        labels: {
            title: t('番茄鐘休息中'),
            hint: t('休息結束前回到 App 就好'),
            overTitle: t('休息時間結束'),
            overHint: t('回到 App，不然會開始算分心'),
        },
    };
}

// 旅行的寬限倒數：移動中用手機不算分心，文字不要寫「快回到聚會」嚇人
export function travelGraceActivity() {
    return {
        kind: 'grace',
        endsAt: 0,
        labels: {
            title: t('移動中不算分心'),
            hint: t('停下來就回到 App，不然會開始算分心'),
            overTitle: t('移動中不算分心'),
            overHint: t('停下來的時間才會算分心'),
        },
    };
}

// 主持人開放使用手機時，跳出 App 要顯示的即時動態。
//   限時（上課）：倒數到結束，時間到換成「開放時間結束」並往上計，跟暫離一樣。
//   直到結束：不顯示時間（結束時間不知道；主持人結束時在外面的人也收不到更新）。
export function phoneOpenActivity(po, context) {
    const isClass = context === 'class';
    const until = Number(po?.until_ms || 0);
    if (po?.mode === 'rest' && context === 'date') {
        // 約會一起休息：固定 5 分鐘、不能提前結束 → 可以直接倒數
        return {
            kind: 'open_timed',
            endsAt: until,
            labels: {
                title: t('一起休息中'),
                hint: t('時間到之前回到 App 就好'),
                overTitle: t('休息時間結束'),
                overHint: t('回到 App，不然會開始算分心'),
            },
        };
    }
    if (po?.mode === 'rest') {
        // 旅行休息：不顯示時間（可能被大家提前結束）；最長 30 分鐘到點時另有通知
        return {
            kind: 'open',
            endsAt: until,
            labels: {
                title: t('休息中'),
                hint: t('大家說休息結束時回到 App 就好'),
                overTitle: t('休息中'),
                overHint: t('大家說休息結束時回到 App 就好'),
            },
        };
    }
    if (po?.mode === 'timed' && until > 0) {
        return {
            kind: 'open_timed',
            endsAt: until,
            labels: {
                title: isClass ? t('老師開放使用手機中') : t('主持人開放使用手機中'),
                hint: t('時間到之前回到 App 就好'),
                overTitle: t('開放時間結束'),
                overHint: t('回到 App，不然會開始算分心'),
            },
        };
    }
    return {
        kind: 'open',
        endsAt: Number(po?.since_ms || 0) + 12 * 3600 * 1000,   // 不顯示時間；給一個固定的遠時間，避免每秒重設
        labels: {
            title: isClass ? t('老師開放使用手機中') : t('主持人開放使用手機中'),
            hint: isClass ? t('老師說結束時回到 App 就好') : t('主持人說結束時回到 App 就好'),
            overTitle: isClass ? t('老師開放使用手機中') : t('主持人開放使用手機中'),
            overHint: isClass ? t('老師說結束時回到 App 就好') : t('主持人說結束時回到 App 就好'),
        },
    };
}
