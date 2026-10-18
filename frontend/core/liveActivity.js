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

export function extendBreakCountdown(endsAtMs) {
    return invoke('updateCountdown', { endsAt: endsAtMs });
}

export function endCountdown() {
    return invoke('endCountdown');
}

// 只在狀態真的改變時才通知原生（呼叫端每秒同步一次）
let _graceKey = '';

export function setGraceCountdown(armed, graceMs) {
    const key = armed ? `on:${graceMs}:${state.lang}` : 'off';
    if (key === _graceKey) return;
    _graceKey = key;
    invoke('setGraceCountdown', {
        armed,
        graceSec: Math.round(graceMs / 1000),
        title: t('快回到聚會'),
        hint: t('倒數結束前回到 App 就不算分心'),
        overTitle: t('分心中'),
        overHint: t('回到 App 就停止計算'),
        appName: t('社交定錨'),
    });
}
