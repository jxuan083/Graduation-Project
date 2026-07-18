// main.js — App entry point (ES Module)
// 啟動順序:
//   1. 載入所有 view 的 HTML 片段 (parallel fetch),插入到 #app
//   2. 初始化 Firebase + auth listener
//   3. 呼叫每個 view module 的 init() 註冊 router + 綁按鈕
//   4. 註冊 WebSocket 訊息 handlers
//   5. 初始化 chrome (auth bar / 浮動鈕 / 邀請橫幅)
//   6. 載入 lottie 動畫 + 後端版本
//   7. 依 URL 決定初始 view (?room=xxx → join,否則 → home)

import { state } from './core/state.js';
import { switchView, register } from './core/router.js';
import { listenAuthChanges } from './core/firebase.js';
import { loadBackendVersion, apiFetch } from './core/api.js';
import { registerAllWsHandlers } from './core/wsHandlers.js';
import { initChrome } from './core/chrome.js';
import { showJoinView } from './views/join/join.js?v=30';
import { events } from './core/events.js';
import { initI18n, t } from './core/i18n.js?v=30';

// ===== 所有需要載入 HTML 片段的 view =====
const VIEW_NAMES = [
    'home', 'scanner', 'meetings', 'meeting-detail', 'friends', 'leaderboard',
    'photo-lightbox', 'question-bank', 'question-edit',
    'qa-source', 'qa-picker', 'profile', 'join',
    'waiting-room', 'host-room', 'sync-ritual', 'focus', 'qa-game',
    'taboo-prepare', 'taboo-countdown', 'taboo-card',
    'buffer', 'summary',
    'member-preview', 'invite-modal',
    'meeting-setup', 'groups', 'group', 'group-setup', 'group-invite', 'pet-vote',
    'group-chat', 'friend-profile',
    'pet-swap',
    'pet-tamagotchi',
];

// ===== view 模組(動態 import,parallel) =====
const VIEW_MODULES = {
    'home':              () => import('./views/home/home.js?v=30'),
    'scanner':           () => import('./views/scanner/scanner.js?v=30'),
    'meetings':          () => import('./views/meetings/meetings.js?v=30'),
    'meeting-detail':    () => import('./views/meeting-detail/meeting-detail.js?v=30'),
    'friends':           () => import('./views/friends/friends.js?v=30'),
    'leaderboard':       () => import('./views/leaderboard/leaderboard.js?v=30'),
    'photo-lightbox':    () => import('./views/photo-lightbox/photo-lightbox.js?v=30'),
    'question-bank':     () => import('./views/question-bank/question-bank.js?v=30'),
    'question-edit':     () => import('./views/question-edit/question-edit.js?v=30'),
    'qa-source':         () => import('./views/qa-source/qa-source.js?v=30'),
    'qa-picker':         () => import('./views/qa-picker/qa-picker.js?v=30'),
    'profile':           () => import('./views/profile/profile.js?v=30'),
    'join':              () => import('./views/join/join.js?v=30'),
    'waiting-room':      () => import('./views/waiting-room/waiting-room.js?v=30'),
    'host-room':         () => import('./views/host-room/host-room.js?v=30'),
    'sync-ritual':       () => import('./views/sync-ritual/sync-ritual.js?v=30'),
    'focus':             () => import('./views/focus/focus.js?v=30'),
    'qa-game':           () => import('./views/qa-game/qa-game.js?v=30'),
    'taboo-prepare':     () => import('./views/taboo-prepare/taboo-prepare.js?v=30'),
    'taboo-countdown':   () => import('./views/taboo-countdown/taboo-countdown.js?v=30'),
    'taboo-card':        () => import('./views/taboo-card/taboo-card.js?v=30'),
    'buffer':            () => import('./views/buffer/buffer.js?v=30'),
    'summary':           () => import('./views/summary/summary.js?v=30'),
    'member-preview':    () => import('./views/member-preview/member-preview.js?v=30'),
    'invite-modal':      () => import('./views/invite-modal/invite-modal.js?v=30'),
    'meeting-setup':     () => import('./views/meeting-setup/meeting-setup.js?v=30'),
    'groups':            () => import('./views/groups/groups.js?v=30'),
    'group':             () => import('./views/group/group.js?v=30'),
    'group-setup':       () => import('./views/group-setup/group-setup.js?v=30'),
    'group-invite':      () => import('./views/group-invite/group-invite.js?v=30'),
    'pet-vote':          () => import('./views/pet-vote/pet-vote.js?v=30'),
    'group-chat':        () => import('./views/group-chat/group-chat.js?v=30'),
    'friend-profile':    () => import('./views/friend-profile/friend-profile.js?v=30'),
    'pet-swap':          () => import('./views/pet-swap/pet-swap.js?v=30'),
    'pet-tamagotchi':    () => import('./views/pet-tamagotchi/pet-tamagotchi.js?v=30'),
};

async function loadAllViewHtml() {
    const app = document.getElementById('app');
    if (!app) throw new Error('#app container missing');

    // parallel fetch 所有 view 的 HTML 片段
    const fetches = VIEW_NAMES.map(async (name) => {
        const res = await fetch(`./views/${name}/${name}.html`);
        if (!res.ok) throw new Error(`Failed to load views/${name}/${name}.html: ${res.status}`);
        return { name, html: await res.text() };
    });
    const results = await Promise.all(fetches);

    // 依原本 VIEW_NAMES 的順序插入,保持渲染穩定
    for (const { html } of results) {
        app.insertAdjacentHTML('beforeend', html);
    }
}

async function initAllViews() {
    // 同時下載所有 module，再依 VIEW_NAMES 順序 init，避免 30+ 個 sequential import waterfall。
    const loaded = await Promise.all(VIEW_NAMES.map(async (name) => {
        try {
            return { name, mod: await VIEW_MODULES[name]() };
        } catch (err) {
            return { name, err };
        }
    }));

    for (const { name, mod, err } of loaded) {
        if (err) {
            console.error(`[init] view "${name}" failed:`, err);
            continue;
        }
        try {
            mod.init?.();
        } catch (initErr) {
            console.error(`[init] view "${name}" failed during init:`, initErr);
        }
    }
}

function initLottie() {
    if (typeof lottie === 'undefined') {
        console.warn('lottie library not loaded');
        return;
    }
    lottie.loadAnimation({
        container: document.getElementById('lottie-orb'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'https://lottie.host/9e4d6a66-515c-48be-85cf-5b43deabeb2b/F9PzUfV6u8.json'
    });
}

// ===== Boot =====
async function boot() {
    try {
        // 1. 把所有 view 的 HTML 載進來
        await loadAllViewHtml();

        // 2. 初始化各 view 的事件綁定 + router 註冊
        await initAllViews();

        // 3. 初始化 Lucide icons（HTML 全部插入後才能跑）
        if (window.lucide) window.lucide.createIcons();

        // 3.5 初始化 i18n（HTML 已插入、icons 已建立後）
        initI18n();

        // 4. 註冊 WebSocket 訊息 handler
        registerAllWsHandlers();

        // 5. 初始化 chrome (auth bar / 浮動鈕 / 橫幅)
        initChrome();

        // 6. 啟動 Firebase auth listener
        listenAuthChanges();

        // 7. 載入後端版本顯示
        loadBackendVersion();

        // 8. Lottie 動畫
        initLottie();

        // 9. 依 URL 決定起始畫面
        const urlParams = new URLSearchParams(window.location.search);
        const roomFromUrl = urlParams.get('room');
        const groupInviteCode = urlParams.get('group_invite');
        const addFriendHandle = urlParams.get('add_friend');
        if (roomFromUrl) {
            state.pendingRoomId = roomFromUrl;
            showJoinView();
        } else if (groupInviteCode) {
            state.pendingGroupInviteCode = groupInviteCode;
            // Clean up URL without reload
            const cleanUrl = window.location.protocol + '//' + window.location.host + window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
            switchView('view-home');
            handleGroupInviteOnBoot(groupInviteCode);
        } else if (addFriendHandle) {
            const cleanUrl = window.location.protocol + '//' + window.location.host + window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
            switchView('view-home');
            handleAddFriendOnBoot(addFriendHandle);
        } else {
            switchView('view-home');
        }

        console.log('[main] App booted successfully');
    } catch (err) {
        console.error('[main] boot failed:', err);
        document.body.innerHTML = `<div style="padding:32px;color:#fff;text-align:center">
            <h2>App 啟動失敗</h2>
            <p>${err.message || err}</p>
            <p>請重新整理頁面再試</p>
        </div>`;
    }
}

function handleGroupInviteOnBoot(code) {
    async function tryJoin() {
        if (!state.currentUser) {
            alert(t('請先登入 Google 帳號，才能透過邀請碼加入群組'));
            state.pendingGroupInviteCode = code;
            return;
        }
        try {
            const { getGroupInviteInfo, joinGroupByInviteCode } = await import('./features/groups/controller.js');
            const { res, data: info } = await getGroupInviteInfo(code);
            if (!res.ok || !info?.name) {
                alert(t('邀請碼無效或已過期：') + (info?.detail || `HTTP ${res.status}`));
                return;
            }
            if (info.already_member) {
                alert(t('你已經是「{name}」的成員了！', { name: info.name }));
                switchView('view-groups');
                return;
            }
            const ok = confirm(t('加入群組「{name}」（{count} 位成員）？', { name: info.name, count: info.member_count }));
            if (!ok) return;
            const { data: joinData } = await joinGroupByInviteCode(code);
            if (joinData?.status === 'success') {
                alert(t('成功加入群組！'));
                switchView('view-groups');
            } else {
                alert(t('加入失敗：') + (joinData?.detail || JSON.stringify(joinData)));
            }
        } catch (err) {
            alert(t('加入失敗：') + (err.message || err));
        } finally {
            state.pendingGroupInviteCode = null;
        }
    }

    if (state.currentUser) {
        tryJoin();
    } else {
        const unsubscribe = events.on('auth:logged-in', () => {
            unsubscribe();
            tryJoin();
        });
    }
}

// 透過 ?add_friend=<handle> 連結進來 → 開對方的好友資料卡
function handleAddFriendOnBoot(handle) {
    async function open() {
        try {
            const { res, data } = await apiFetch(`/api/users/by_handle/${encodeURIComponent(handle)}`);
            if (res.ok && data?.profile?.uid) {
                state.friendProfileUid = data.profile.uid;
                switchView('view-friend-profile');
            } else {
                alert(t('找不到這個 ID 的使用者'));
            }
        } catch (_) { /* noop */ }
    }
    if (state.currentUser) {
        open();
    } else {
        alert(t('請先登入 Google 帳號，才能加好友'));
        const unsubscribe = events.on('auth:logged-in', () => { unsubscribe(); open(); });
    }
}

boot();
