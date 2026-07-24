// core/chrome.js — App 殼層 UI: auth bar、user dropdown、邀請橫幅、返回聚會浮動鈕
// 這些元件不屬於任何單一 view,而是常駐在 index.html 上層

import { state } from './state.js';
import { events } from './events.js';
import { switchView, getActiveViewElement, isMeetingViewId } from './router.js';
import { doGoogleLogin, doLocalDevLogin, doSignOut } from './firebase.js';
import { FIREBASE_EMULATORS } from './config.js';
import { cleanupSession } from './session.js';
import { sendAction } from './ws.js';
import { apiFetch } from './api.js';
import { loadFriendUidCache, loadFriendRequestsCache } from '../features/friends/controller.js';
import { openProfileView } from '../views/profile/profile.js?v=40';
import { openFriendsView } from '../views/friends/friends.js?v=40';
import { openLeaderboardView } from '../features/leaderboard/controller.js';
import { openMeetingsList } from '../features/meetings/controller.js';
import { enablePush, isPushAvailable, reEnablePushIfPreviouslyGranted } from './push.js';
import { t } from './i18n.js';

export function initChrome() {
    // ===== Auth bar =====
    document.getElementById('btn-google-login').onclick = doGoogleLogin;
    const devLoginButton = document.getElementById('btn-dev-login');
    if (devLoginButton) {
        devLoginButton.style.display = FIREBASE_EMULATORS.enabled ? 'inline-flex' : 'none';
        devLoginButton.onclick = doLocalDevLogin;
    }

    const userMenuToggle = document.getElementById('btn-user-menu-toggle');
    const userMenuDropdown = document.getElementById('user-menu-dropdown');
    userMenuToggle.onclick = (e) => {
        e.stopPropagation();
        const open = userMenuDropdown.style.display === 'block';
        userMenuDropdown.style.display = open ? 'none' : 'block';
        userMenuToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    };
    document.addEventListener('click', (e) => {
        if (!userMenuDropdown.contains(e.target) && !userMenuToggle.contains(e.target)) {
            userMenuDropdown.style.display = 'none';
            userMenuToggle.setAttribute('aria-expanded', 'false');
        }
    });
    const closeMenu = () => {
        userMenuDropdown.style.display = 'none';
        userMenuToggle.setAttribute('aria-expanded', 'false');
    };

    document.getElementById('btn-open-profile').onclick = () => { closeMenu(); openProfileView(); };
    document.getElementById('btn-open-friends').onclick = () => { closeMenu(); openFriendsView(); };
    document.getElementById('btn-open-group-pets').onclick = () => { closeMenu(); state.tamagotchiGroupId = null; switchView('view-pet-tamagotchi'); };
    document.getElementById('btn-open-leaderboard').onclick = () => { closeMenu(); openLeaderboardView(); };
    document.getElementById('btn-menu-meetings').onclick = () => { closeMenu(); openMeetingsList(); };
    const pushButton = document.getElementById('btn-enable-push');
    if (pushButton) {
        pushButton.style.display = isPushAvailable() ? '' : 'none';
        pushButton.onclick = () => { closeMenu(); enablePush(); };
    }
    document.getElementById('btn-logout').onclick = () => { closeMenu(); handleLogout(); };

    // ===== 「返回聚會」浮動按鈕 =====
    const btnResume = document.getElementById('btn-resume-meeting');
    if (btnResume) btnResume.onclick = resumeMeeting;

    // 監聽 view 變化 → 刷新返回聚會按鈕顯示
    events.on('view:changed', refreshResumeMeetingBtn);
    events.on('session:cleanup', refreshResumeMeetingBtn);

    // ===== Auth 狀態變動 → renderAuthBar + 刷新邀請橫幅 =====
    events.on('auth:logged-in', async () => {
        try { await Promise.all([loadFriendUidCache(), loadFriendRequestsCache()]); }
        catch (err) { console.warn('load friend caches on login failed:', err); }
        renderAuthBar();
        refreshIncomingBanner();
        reEnablePushIfPreviouslyGranted();
    });
    events.on('auth:logged-out', () => {
        hideIncomingBanner();
        updateMenuBadge(0);
        renderAuthBar();
    });
    events.on('home:show', () => refreshIncomingBanner());
    events.on('friends:changed', () => refreshIncomingBanner());

    // 聚會中隱藏個人資料列
    events.on('view:changed', ({ viewId }) => refreshAuthBarVisibility(viewId));

    renderAuthBar();
}

function refreshAuthBarVisibility(viewId) {
    const loggedIn = document.getElementById('auth-logged-in');
    if (!loggedIn) return;
    if (isMeetingViewId(viewId)) {
        loggedIn.style.display = 'none';
        const dd = document.getElementById('user-menu-dropdown');
        if (dd) dd.style.display = 'none';
    } else {
        // 只在已登入時才顯示
        if (state.currentUser) {
            loggedIn.style.display = 'flex';
        }
    }
}

function renderAuthBar() {
    const loggedOut = document.getElementById('auth-logged-out');
    const loggedIn = document.getElementById('auth-logged-in');
    // 只要 Firebase 已登入就視為登入狀態（暱稱/頭貼可 fallback 用 Google 帳號），
    // 避免後端/profile 尚未載入時登入鈕還留著。
    if (state.currentUser) {
        loggedOut.style.display = 'none';
        loggedIn.style.display = 'flex';
        const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
        document.getElementById('auth-avatar').src =
            state.currentProfile?.photoURL || state.currentUser.photoURL || PLACEHOLDER;
        document.getElementById('auth-nickname').innerText =
            state.currentProfile?.nickname || state.currentUser.displayName || '使用者';
    } else {
        loggedOut.style.display = 'flex';
        loggedIn.style.display = 'none';
        const dd = document.getElementById('user-menu-dropdown');
        if (dd) dd.style.display = 'none';
    }
}

async function handleLogout() {
    const inSession = ['view-host-room','view-waiting-room','view-sync-ritual',
                       'view-focus','view-qa-game','view-buffer'].some(id => {
        const el = document.getElementById(id);
        return el && el.classList.contains('active');
    });

    if (inSession || state.roomId) {
        const msg = state.amIHost
            ? '登出將會取消這次聚會並通知所有成員,確定要登出嗎?'
            : '登出將會離開目前的聚會並返回首頁,確定要登出嗎?';
        if (!confirm(msg)) return;

        if (state.amIHost && state.ws && state.ws.readyState === WebSocket.OPEN) {
            try {
                const mins = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0;
                sendAction('END_SESSION', { reason: 'host_left', duration_minutes: mins });
                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                console.warn('END_SESSION broadcast failed:', err);
            }
        }
        cleanupSession();
        switchView('view-home');
    }
    await doSignOut();
}

// ===== 邀請橫幅 + 紅點 =====
async function refreshIncomingBanner() {
    if (!state.currentUser) {
        hideIncomingBanner();
        updateMenuBadge(0);
        return;
    }
    try { await loadFriendRequestsCache(); }
    catch (err) { console.warn('refreshIncomingBanner cache failed:', err); }

    const count = state.incomingPendingSet.size;
    updateMenuBadge(count);
    const banner = document.getElementById('incoming-banner');
    const countEl = document.getElementById('incoming-banner-count');
    const subEl = document.getElementById('incoming-banner-sub');
    if (!banner) return;
    if (count === 0) { banner.style.display = 'none'; return; }
    banner.style.display = 'flex';
    if (countEl) countEl.innerText = count;
    if (subEl) {
        try {
            const { data } = await apiFetch('/api/friend_requests');
            const incoming = (data && data.incoming) || [];
            if (incoming.length > 0) {
                const firstName = incoming[0].other_nickname || '匿名';
                subEl.innerText = incoming.length === 1
                    ? t('來自 {name}', { name: firstName })
                    : t('來自 {name} 等 {count} 人', { name: firstName, count: incoming.length });
            } else {
                subEl.innerText = '';
            }
        } catch (_) { subEl.innerText = ''; }
    }
}

function hideIncomingBanner() {
    const banner = document.getElementById('incoming-banner');
    if (banner) banner.style.display = 'none';
}

function updateMenuBadge(count) {
    const dot = document.getElementById('menu-red-dot');
    const badge = document.getElementById('menu-friends-badge');
    if (dot) dot.style.display = count > 0 ? 'inline-block' : 'none';
    if (badge) {
        badge.style.display = count > 0 ? 'inline-block' : 'none';
        badge.innerText = count;
    }
}

// ===== 返回聚會浮動按鈕 =====
function refreshResumeMeetingBtn() {
    const btn = document.getElementById('btn-resume-meeting');
    if (!btn) return;
    const currentView = getActiveViewElement();
    const inMeetingNow = state.roomId && state.ws && state.ws.readyState === WebSocket.OPEN;
    const notOnMeetingPage = !currentView || !isMeetingViewId(currentView.id);
    const isOverlay = currentView && currentView.classList.contains('overlay');
    const hasLastView = state.lastMeetingView && document.body.contains(state.lastMeetingView);

    btn.style.display = (inMeetingNow && notOnMeetingPage && !isOverlay && hasLastView) ? 'block' : 'none';
}

function resumeMeeting() {
    if (state.lastMeetingView) {
        switchView(state.lastMeetingView.id);
    }
    refreshResumeMeetingBtn();
}
