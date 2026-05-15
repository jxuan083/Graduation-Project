// core/router.js — 取代原本的 switchView + uiViews 陣列
// 每個 view module 用 register() 把自己註冊進來,switchView() 統一切換顯示

import { state } from './state.js';
import { events } from './events.js';

const views = new Map();

// 哪些 view 算「在聚會中」(用於返回聚會浮動鈕、登出確認)
const MEETING_VIEW_IDS = new Set([
    'view-host-room', 'view-waiting-room', 'view-sync-ritual',
    'view-focus', 'view-qa-game', 'view-buffer',
    'view-taboo-prepare', 'view-taboo-countdown', 'view-taboo-card'
]);

export function register(viewId, config) {
    // config: { element, onShow?, onHide? }
    if (!config || !config.element) {
        console.warn(`[router] register("${viewId}") missing element`);
        return;
    }
    views.set(viewId, config);
}

export function getViewElement(viewId) {
    return views.get(viewId)?.element ?? null;
}

export function getActiveViewElement() {
    for (const cfg of views.values()) {
        if (cfg.element.classList.contains('active')) return cfg.element;
    }
    return null;
}

export function isMeetingViewId(viewId) {
    return MEETING_VIEW_IDS.has(viewId);
}

export function switchView(viewId) {
    // 如果 viewId 是 element,轉成 id
    if (viewId && typeof viewId === 'object' && viewId.id) viewId = viewId.id;
    const target = views.get(viewId);
    if (!target) {
        console.warn('[router] unknown view:', viewId);
        return;
    }

    // 記錄離開聚會頁前的位置 (給「返回聚會」浮動鈕用)
    try {
        const currentActive = getActiveViewElement();
        const leavingMeeting = currentActive && MEETING_VIEW_IDS.has(currentActive.id);
        const goingToMeeting = MEETING_VIEW_IDS.has(viewId);
        const wsAlive = state.ws && state.ws.readyState === WebSocket.OPEN;
        if (leavingMeeting && !goingToMeeting && wsAlive) {
            state.lastMeetingView = currentActive;
        }
        if (goingToMeeting) state.lastMeetingView = null;
    } catch (_) { /* noop */ }

    // 隱藏所有 view + 呼叫 onHide
    for (const [id, cfg] of views) {
        if (cfg.element.classList.contains('active')) {
            cfg.element.classList.remove('active');
            try { cfg.onHide?.(); } catch (e) { console.warn(`[router] ${id}.onHide:`, e); }
        }
    }

    // 顯示目標 view + 呼叫 onShow
    target.element.classList.add('active');
    try { target.onShow?.(); } catch (e) { console.warn(`[router] ${viewId}.onShow:`, e); }

    // 廣播事件,讓「返回聚會」按鈕 / banner 可以重新刷新
    setTimeout(() => events.emit('view:changed', { viewId }), 0);
}
