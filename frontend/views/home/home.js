// views/home/home.js — 首頁（front-preview 設計：群組九宮格 + 4 顆功能列）
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { events } from '../../core/events.js';
import { openQuestionBank } from '../question-bank/question-bank.js';
import { openFriendsView } from '../friends/friends.js';
import { fetchMyGroups } from '../../features/groups/controller.js?v=52';
import { FIREBASE_EMULATORS } from '../../core/config.js';
import { openLoginMethodSheet } from '../../core/login-sheet.js';
import { t } from '../../core/i18n.js';
import { vibrate } from '../../core/haptics.js?v=52';
import { showToast } from '../../utils/toast.js';

let _groupsCacheTs = 0;
const LANDING_GUIDE_KEY = 'phubbing_landing_guide_seen';
const ONBOARDING_STEPS = [
    '你好，我是你們的群組寵物。',
    '手機可以留在手上，注意力留在彼此身上。',
    'Phubbing Anchor 會幫你發起聚會、邀請夥伴、一起完成定錨。只要更了解彼此，這場聚會就有意義。',
    '開始很簡單：揪齊夥伴 → 一起定錨 → 專心相聚。',
    '你可以現在發起聚會，或加入朋友的聚會。',
];

export function init() {
    loadHomeOnboardingStyles();

    register('view-home', {
        element: document.getElementById('view-home'),
        onShow: () => {
            events.emit('home:show');
            renderGroups();
        },
    });

    // 題庫
    document.getElementById('btn-question-library').onclick = openQuestionBank;

    initHomeOnboarding();
    initHomeReplayGuide();

    // 好友邀請橫幅「查看」
    const bannerView = document.getElementById('btn-incoming-banner-view');
    if (bannerView) bannerView.onclick = () => openFriendsView('incoming');

    // 搜尋群組
    document.getElementById('home-search').addEventListener('input', (e) => filterGroups(e.target.value));

    const homeGoogleLogin = document.getElementById('btn-home-google-login');
    if (homeGoogleLogin) homeGoogleLogin.onclick = openLoginMethodSheet;
    const homeDevLogin = document.getElementById('btn-home-dev-login');
    if (homeDevLogin) {
        homeDevLogin.style.display = FIREBASE_EMULATORS.enabled ? 'inline-flex' : 'none';
        homeDevLogin.onclick = openLoginMethodSheet;
    }

    // 登入/登出後刷新群組
    events.on('auth:logged-in', () => { _groupsCacheTs = 0; renderGroups(); });
    events.on('auth:logged-out', () => { _groupsCacheTs = 0; renderGroups(); });
}

function loadHomeOnboardingStyles() {
    if (document.getElementById('home-onboarding-css')) return;
    const link = document.createElement('link');
    link.id = 'home-onboarding-css';
    link.rel = 'stylesheet';
    link.href = './views/home/home-onboarding.css?v=52';
    document.head.appendChild(link);
}

// onboarding 看完後整塊從 DOM 移除，所以要先留一份原始 markup，
// 「重看新手教學」才有東西可以還原。
let _purposeTemplate = '';

function initHomeReplayGuide() {
    const replay = document.getElementById('btn-home-replay-onboarding');
    if (!replay) return;
    replay.onclick = () => {
        if (!_purposeTemplate) return;
        localStorage.removeItem(LANDING_GUIDE_KEY);
        if (!document.getElementById('home-purpose')) {
            const topRow = document.querySelector('#view-home .top-row');
            if (!topRow) return;
            topRow.insertAdjacentHTML('afterend', _purposeTemplate);
            if (window.lucide) window.lucide.createIcons();
        }
        initHomeOnboarding();
    };
}

function initHomeOnboarding() {
    const purpose = document.getElementById('home-purpose');
    if (!purpose) return;

    if (!_purposeTemplate) _purposeTemplate = purpose.outerHTML;

    const hasSeenGuide = localStorage.getItem(LANDING_GUIDE_KEY) === '1';
    if (hasSeenGuide) {
        removePurpose();
        return;
    }

    const messages = document.getElementById('home-onboarding-messages');
    const next = document.getElementById('btn-home-onboarding-next');
    const skip = document.getElementById('btn-home-onboarding-skip');
    const actions = document.getElementById('home-onboarding-actions');
    const create = document.getElementById('btn-home-onboarding-create');
    const join = document.getElementById('btn-home-onboarding-join');
    if (!messages || !next || !skip || !actions || !create || !join) return;

    let shownCount = 0;
    const steps = getOnboardingSteps();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    const finish = () => {
        localStorage.setItem(LANDING_GUIDE_KEY, '1');
        removePurpose();
    };
    const showActions = () => {
        next.hidden = true;
        actions.hidden = false;
        if (window.lucide) window.lucide.createIcons();
    };
    const showNext = () => {
        if (shownCount >= steps.length) {
            showActions();
            return;
        }
        const bubble = document.createElement('p');
        bubble.className = 'home-onboarding-bubble';
        bubble.textContent = steps[shownCount];
        messages.appendChild(bubble);
        shownCount += 1;
        vibrate(10);
        if (shownCount >= steps.length) showActions();
    };

    skip.onclick = finish;
    next.onclick = showNext;
    create.onclick = () => {
        finish();
        handleCreateRoom();
    };
    join.onclick = () => {
        finish();
        switchView('view-join-method');
    };

    if (reducedMotion) {
        steps.forEach((text) => {
            const bubble = document.createElement('p');
            bubble.className = 'home-onboarding-bubble';
            bubble.textContent = text;
            messages.appendChild(bubble);
        });
        shownCount = steps.length;
        showActions();
    } else {
        window.setTimeout(showNext, 120);
    }
}

function getOnboardingSteps() {
    const template = document.getElementById('home-onboarding-steps');
    const steps = Array.from(template?.content?.querySelectorAll('p') || [])
        .map((node) => node.textContent.trim())
        .filter(Boolean);
    return steps.length ? steps : ONBOARDING_STEPS;
}

function removePurpose() {
    const purpose = document.getElementById('home-purpose');
    if (purpose) purpose.remove();
}

// ── 群組九宮格 ──
async function renderGroups() {
    const grid = document.getElementById('home-groups-grid');
    const empty = document.getElementById('home-groups-empty');
    const guest = document.getElementById('home-groups-guest');
    if (!grid) return;

    if (!state.currentUser) {
        grid.innerHTML = '';
        empty.style.display = 'none';
        guest.style.display = 'block';
        return;
    }
    guest.style.display = 'none';

    // 先用快取立即畫，再背景刷新
    if (Array.isArray(state.myGroups) && state.myGroups.length) paintGroups(state.myGroups);

    if (Date.now() - _groupsCacheTs < 20_000 && Array.isArray(state.myGroups)) {
        paintGroups(state.myGroups);
        return;
    }
    try {
        const groups = await fetchMyGroups();
        _groupsCacheTs = Date.now();
        paintGroups(groups || []);
    } catch (err) {
        console.warn('[home] fetchMyGroups failed:', err);
        paintGroups(Array.isArray(state.myGroups) ? state.myGroups : []);
    }
}

function paintGroups(groups) {
    const grid = document.getElementById('home-groups-grid');
    const empty = document.getElementById('home-groups-empty');
    if (!grid) return;

    if (!groups.length) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    grid.innerHTML = groups.map(g => {
        const name = escapeHtml(g.name || t('未命名群組'));
        const img = g.pet_face_url
            ? `<img src="${escapeAttr(g.pet_face_url)}" alt="">`
            : '<i data-lucide="paw-print" aria-hidden="true"></i>';
        return `<button class="group-card" data-group-id="${escapeAttr(g.group_id)}" data-group-name="${escapeAttr(g.name || '')}">
            <div class="group-img-area">${img}</div>
            <span class="group-name">${name}</span>
        </button>`;
    }).join('');

    grid.querySelectorAll('.group-card').forEach(card => {
        card.onclick = () => openGroup(card.dataset.groupId, card.dataset.groupName);
    });
    if (window.lucide) window.lucide.createIcons();
}

function filterGroups(qRaw) {
    const q = (qRaw || '').trim().toLowerCase();
    const grid = document.getElementById('home-groups-grid');
    if (!grid) return;
    grid.querySelectorAll('.group-card').forEach(card => {
        const name = (card.dataset.groupName || '').toLowerCase();
        card.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
}

function openGroup(groupId, groupName) {
    // 導向群組詳情頁（view-group）。帶入手上的群組物件，詳情頁會再抓完整資料。
    const g = (Array.isArray(state.myGroups) ? state.myGroups : [])
        .find(x => String(x.group_id) === String(groupId));
    state.currentGroupDetail = g || { group_id: groupId, name: groupName };
    switchView('view-group');
}

export function handleCreateRoom() {
    if (!state.currentUser) {
        // 不要用 alert：在 WKWebView 裡會凍結整個 webview。直接開登入選單。
        showToast(t('請先登入，才能保存房間與聚會回顧'));
        openLoginMethodSheet();
        return;
    }
    switchView('view-meeting-setup');
}

// ── utils ──
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
