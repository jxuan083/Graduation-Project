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
import { loadBackendVersion } from './core/api.js';
import { registerAllWsHandlers } from './core/wsHandlers.js';
import { initChrome } from './core/chrome.js';
import { showJoinView } from './views/join/join.js';

// ===== 所有需要載入 HTML 片段的 view =====
const VIEW_NAMES = [
    'home', 'scanner', 'meetings', 'meeting-detail', 'friends', 'leaderboard',
    'about', 'photo-lightbox', 'question-bank', 'question-edit',
    'qa-source', 'qa-picker', 'profile', 'join',
    'waiting-room', 'host-room', 'sync-ritual', 'focus', 'qa-game',
    'taboo-prepare', 'taboo-countdown', 'taboo-card',
    'buffer', 'summary',
    'member-preview', 'invite-modal'
];

// ===== view 模組(動態 import,parallel) =====
const VIEW_MODULES = {
    'home':              () => import('./views/home/home.js'),
    'scanner':           () => import('./views/scanner/scanner.js'),
    'meetings':          () => import('./views/meetings/meetings.js'),
    'meeting-detail':    () => import('./views/meeting-detail/meeting-detail.js'),
    'friends':           () => import('./views/friends/friends.js'),
    'leaderboard':       () => import('./views/leaderboard/leaderboard.js'),
    'about':             () => import('./views/about/about.js'),
    'photo-lightbox':    () => import('./views/photo-lightbox/photo-lightbox.js'),
    'question-bank':     () => import('./views/question-bank/question-bank.js'),
    'question-edit':     () => import('./views/question-edit/question-edit.js'),
    'qa-source':         () => import('./views/qa-source/qa-source.js'),
    'qa-picker':         () => import('./views/qa-picker/qa-picker.js'),
    'profile':           () => import('./views/profile/profile.js'),
    'join':              () => import('./views/join/join.js'),
    'waiting-room':      () => import('./views/waiting-room/waiting-room.js'),
    'host-room':         () => import('./views/host-room/host-room.js'),
    'sync-ritual':       () => import('./views/sync-ritual/sync-ritual.js'),
    'focus':             () => import('./views/focus/focus.js'),
    'qa-game':           () => import('./views/qa-game/qa-game.js'),
    'taboo-prepare':     () => import('./views/taboo-prepare/taboo-prepare.js'),
    'taboo-countdown':   () => import('./views/taboo-countdown/taboo-countdown.js'),
    'taboo-card':        () => import('./views/taboo-card/taboo-card.js'),
    'buffer':            () => import('./views/buffer/buffer.js'),
    'summary':           () => import('./views/summary/summary.js'),
    'member-preview':    () => import('./views/member-preview/member-preview.js'),
    'invite-modal':      () => import('./views/invite-modal/invite-modal.js'),
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
    // 動態 import 並依序呼叫每個 view 的 init() 註冊事件
    for (const name of VIEW_NAMES) {
        try {
            const mod = await VIEW_MODULES[name]();
            mod.init?.();
        } catch (err) {
            console.error(`[init] view "${name}" failed:`, err);
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

        // 3. 註冊 WebSocket 訊息 handler
        registerAllWsHandlers();

        // 4. 初始化 chrome (auth bar / 浮動鈕 / 橫幅)
        initChrome();

        // 5. 啟動 Firebase auth listener
        listenAuthChanges();

        // 6. 載入後端版本顯示
        loadBackendVersion();

        // 7. Lottie 動畫
        initLottie();

        // 8. 依 URL 決定起始畫面
        const urlParams = new URLSearchParams(window.location.search);
        const roomFromUrl = urlParams.get('room');
        if (roomFromUrl) {
            state.pendingRoomId = roomFromUrl;
            showJoinView();
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

boot();
