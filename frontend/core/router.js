// core/router.js — 取代原本的 switchView + uiViews 陣列
// 每個 view module 用 register() 把自己註冊進來,switchView() 統一切換顯示

import { state } from './state.js';
import { events } from './events.js';
import { vibrate } from './haptics.js?v=57';

const views = new Map();
const navigationStack = [];
let currentViewId = null;
let navSeq = 0;
let applyingPopState = false;
let nativeBackInstalled = false;
let edgePanInstalled = false;
let edgePan = null;

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

export function getCurrentViewId() {
    return currentViewId || getActiveViewElement()?.id || null;
}

export function canGoBack() {
    const viewId = getCurrentViewId();
    return Boolean(viewId && !MEETING_VIEW_IDS.has(viewId) && navigationStack.length > 1);
}

export function switchView(viewId, options = {}) {
    // 如果 viewId 是 element,轉成 id
    if (viewId && typeof viewId === 'object' && viewId.id) viewId = viewId.id;
    const target = views.get(viewId);
    if (!target) {
        console.warn('[router] unknown view:', viewId);
        return;
    }
    const replace = Boolean(options.replace) || navigationStack.length === 0 || viewId === currentViewId;

    // 記錄離開聚會頁前的位置 (給「返回聚會」浮動鈕用)
    applyView(viewId, { direction: replace ? 'none' : 'forward' });

    if (!applyingPopState) {
        writeHistory(viewId, { replace });
    }
}

export function replaceView(viewId) {
    switchView(viewId, { replace: true });
}

export function back() {
    const viewId = getCurrentViewId();
    if (viewId && MEETING_VIEW_IDS.has(viewId)) {
        return false;
    }

    if (navigationStack.length > 1) {
        window.history.back();
        return true;
    }

    if (viewId === 'view-home') {
        exitNativeApp();
        return false;
    }

    switchView('view-home', { replace: true });
    return true;
}

export function initNavigationRuntime() {
    ensureHistoryState();
    window.addEventListener('popstate', handlePopState);
    installBackButtonCapture();
    installNativeBackButton();
    installEdgePanGesture();
}

function applyView(viewId, { direction = 'none' } = {}) {
    const target = views.get(viewId);
    if (!target) return;

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
    playViewEntry(target.element, direction);
    currentViewId = viewId;
    try { target.onShow?.(); } catch (e) { console.warn(`[router] ${viewId}.onShow:`, e); }

    // 廣播事件,讓「返回聚會」按鈕 / banner 可以重新刷新
    setTimeout(() => events.emit('view:changed', { viewId }), 0);
    if (window.lucide) window.lucide.createIcons();
}

function writeHistory(viewId, { replace = false } = {}) {
    ensureHistoryState();
    if (replace && navigationStack.length) {
        navigationStack[navigationStack.length - 1] = viewId;
    } else {
        navigationStack.push(viewId);
        navSeq += 1;
    }

    const historyState = { phubbingViewId: viewId, phubbingNavIndex: navigationStack.length - 1, phubbingNavSeq: navSeq };
    try {
        const fn = replace ? 'replaceState' : 'pushState';
        window.history[fn](historyState, '', window.location.href);
    } catch (err) {
        console.warn('[router] history write failed:', err);
    }
}

function ensureHistoryState() {
    const activeId = getCurrentViewId() || 'view-home';
    if (navigationStack.length === 0) {
        navigationStack.push(activeId);
        currentViewId = activeId;
    }
    if (!history.state || !history.state.phubbingViewId) {
        try {
            window.history.replaceState(
                { phubbingViewId: activeId, phubbingNavIndex: navigationStack.length - 1, phubbingNavSeq: navSeq },
                '',
                window.location.href
            );
        } catch (_) { /* noop */ }
    }
}

function handlePopState(event) {
    const targetId = event.state?.phubbingViewId;
    if (!targetId || !views.has(targetId)) {
        switchView('view-home', { replace: true });
        return;
    }

    const currentId = getCurrentViewId();
    if (currentId && MEETING_VIEW_IDS.has(currentId) && targetId !== currentId) {
        try { window.history.forward(); } catch (_) {}
        return;
    }

    applyingPopState = true;
    applyView(targetId, { direction: 'back' });
    applyingPopState = false;

    const targetIndex = Number(event.state?.phubbingNavIndex);
    if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < navigationStack.length) {
        navigationStack.length = targetIndex + 1;
    }
}

function playViewEntry(element, direction) {
    element.classList.remove('nav-enter-forward', 'nav-enter-back');
    if (direction === 'none' || prefersReducedMotion()) return;
    void element.offsetWidth;
    const className = direction === 'back' ? 'nav-enter-back' : 'nav-enter-forward';
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), 280);
}

function installBackButtonCapture() {
    document.addEventListener('click', (event) => {
        const button = event.target?.closest?.('.btn-back');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        back();
    }, true);
}

function getNativeAppPlugin() {
    return window.Capacitor?.Plugins?.App || null;
}

function isNativePlatform() {
    try { return Boolean(window.Capacitor?.isNativePlatform?.()); }
    catch (_) { return false; }
}

function installNativeBackButton() {
    if (nativeBackInstalled) return;
    nativeBackInstalled = true;
    const app = getNativeAppPlugin();
    if (!app?.addListener) return;
    app.addListener('backButton', () => {
        back();
    }).catch?.((err) => console.warn('[router] App.backButton listener failed:', err));
}

function exitNativeApp() {
    const app = getNativeAppPlugin();
    if (isNativePlatform() && app?.exitApp) {
        app.exitApp().catch?.((err) => console.warn('[router] App.exitApp failed:', err));
    }
}

function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function installEdgePanGesture() {
    if (edgePanInstalled) return;
    edgePanInstalled = true;
    if (!window.PointerEvent || prefersReducedMotion()) return;

    document.addEventListener('pointerdown', startEdgePan, { passive: true });
    document.addEventListener('pointermove', moveEdgePan, { passive: false });
    document.addEventListener('pointerup', endEdgePan, { passive: true });
    document.addEventListener('pointercancel', cancelEdgePan, { passive: true });
}

function startEdgePan(event) {
    if (event.pointerType === 'mouse') return;
    if (event.clientX > 24 || !canGoBack()) return;
    const active = getActiveViewElement();
    if (!active) return;
    edgePan = {
        pointerId: event.pointerId,
        element: active,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastT: performance.now(),
        velocity: 0,
        dragging: false,
    };
}

function moveEdgePan(event) {
    if (!edgePan || event.pointerId !== edgePan.pointerId) return;
    const dx = Math.max(0, event.clientX - edgePan.startX);
    const dy = Math.abs(event.clientY - edgePan.startY);
    if (!edgePan.dragging) {
        if (dy > 18 && dy > dx) {
            cancelEdgePan();
            return;
        }
        if (dx < 8) return;
        edgePan.dragging = true;
        edgePan.element.classList.add('nav-edge-pan-active');
    }
    event.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - edgePan.lastT);
    edgePan.velocity = (event.clientX - edgePan.lastX) / dt;
    edgePan.lastX = event.clientX;
    edgePan.lastT = now;
    const x = Math.min(dx, window.innerWidth * 0.92);
    edgePan.element.style.setProperty('--nav-pan-x', `${x}px`);
}

function endEdgePan(event) {
    if (!edgePan || event.pointerId !== edgePan.pointerId) return;
    const dx = Math.max(0, event.clientX - edgePan.startX);
    const shouldCommit = edgePan.dragging && (dx > window.innerWidth * 0.36 || edgePan.velocity > 0.55);
    const el = edgePan.element;
    if (shouldCommit) {
        el.classList.add('nav-edge-pan-commit');
        el.style.setProperty('--nav-pan-x', `${window.innerWidth}px`);
        setTimeout(() => {
            if (back()) vibrate(10);
            resetEdgePanElement(el);
        }, 120);
    } else {
        el.classList.add('nav-edge-pan-cancel');
        el.style.setProperty('--nav-pan-x', '0px');
        setTimeout(() => resetEdgePanElement(el), 160);
    }
    edgePan = null;
}

function cancelEdgePan() {
    if (!edgePan) return;
    resetEdgePanElement(edgePan.element);
    edgePan = null;
}

function resetEdgePanElement(el) {
    if (!el) return;
    el.classList.remove('nav-edge-pan-active', 'nav-edge-pan-commit', 'nav-edge-pan-cancel');
    el.style.removeProperty('--nav-pan-x');
}
