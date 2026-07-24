// views/home/home.js — 首頁（front-preview 設計：群組九宮格 + 4 顆功能列）
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { events } from '../../core/events.js';
import { openQuestionBank } from '../question-bank/question-bank.js';
import { openFriendsView } from '../friends/friends.js';
import { fetchMyGroups } from '../../features/groups/controller.js?v=40';
import { doGoogleLogin, doLocalDevLogin } from '../../core/firebase.js';
import { FIREBASE_EMULATORS } from '../../core/config.js';
import { t } from '../../core/i18n.js';

let _groupsCacheTs = 0;

export function init() {
    register('view-home', {
        element: document.getElementById('view-home'),
        onShow: () => {
            events.emit('home:show');
            renderGroups();
        },
    });

    // 題庫
    document.getElementById('btn-question-library').onclick = openQuestionBank;

    // 第一次進站預設展開三步引導；看過後保留可再次展開的入口。
    const guideToggle = document.getElementById('btn-home-guide');
    const guidePanel = document.getElementById('home-guide-panel');
    if (guideToggle && guidePanel) {
        const hasSeenGuide = localStorage.getItem('phubbing_landing_guide_seen') === '1';
        setGuideExpanded(!hasSeenGuide);
        guideToggle.onclick = () => {
            const nextExpanded = guideToggle.getAttribute('aria-expanded') !== 'true';
            setGuideExpanded(nextExpanded);
            if (!nextExpanded) localStorage.setItem('phubbing_landing_guide_seen', '1');
        };
    }

    // 好友邀請橫幅「查看」
    const bannerView = document.getElementById('btn-incoming-banner-view');
    if (bannerView) bannerView.onclick = () => openFriendsView('incoming');

    // 搜尋群組
    document.getElementById('home-search').addEventListener('input', (e) => filterGroups(e.target.value));

    // 底部功能列
    document.getElementById('btn-create-room').onclick = handleCreateRoom;
    document.getElementById('btn-scan-qr').onclick = () => switchView('view-join-method');
    document.getElementById('btn-open-groups').onclick = () => switchView('view-groups');
    document.getElementById('btn-open-friends').onclick = () => openFriendsView('add');
    document.getElementById('btn-home-more-slot').onclick = () => {};
    document.getElementById('btn-home-manage-groups').onclick = () => switchView('view-groups');

    // 預約聚會 sheet
    const scheduleButton = document.getElementById('btn-home-schedule');
    if (scheduleButton) scheduleButton.onclick = openScheduleSheet;
    document.getElementById('btn-sch-cancel').onclick = () => { document.getElementById('home-schedule-sheet').hidden = true; };
    document.getElementById('btn-sch-ics').onclick = createScheduleIcs;

    const homeGoogleLogin = document.getElementById('btn-home-google-login');
    if (homeGoogleLogin) homeGoogleLogin.onclick = doGoogleLogin;
    const homeDevLogin = document.getElementById('btn-home-dev-login');
    if (homeDevLogin) {
        homeDevLogin.style.display = FIREBASE_EMULATORS.enabled ? 'inline-flex' : 'none';
        homeDevLogin.onclick = doLocalDevLogin;
    }
    const homeJoinGuest = document.getElementById('btn-home-join-guest');
    if (homeJoinGuest) homeJoinGuest.onclick = () => switchView('view-join-method');

    // 登入/登出後刷新群組
    events.on('auth:logged-in', () => { _groupsCacheTs = 0; renderGroups(); });
    events.on('auth:logged-out', () => { _groupsCacheTs = 0; renderGroups(); });
}

function setGuideExpanded(expanded) {
    const toggle = document.getElementById('btn-home-guide');
    const panel = document.getElementById('home-guide-panel');
    if (!toggle || !panel) return;
    toggle.setAttribute('aria-expanded', String(expanded));
    panel.hidden = !expanded;
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

function handleCreateRoom() {
    if (!state.currentUser) {
        const devLogin = document.getElementById('btn-home-dev-login');
        if (devLogin && FIREBASE_EMULATORS.enabled) {
            devLogin.focus();
        }
        alert(t('請先登入，才能保存房間與聚會回顧'));
        return;
    }
    switchView('view-meeting-setup');
}

// ── 預約聚會：產生 .ics 邀請檔 ──
function openScheduleSheet() {
    const when = new Date(Date.now() + 60 * 60 * 1000);
    when.setSeconds(0, 0);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('sch-time').value = local;
    document.getElementById('home-schedule-sheet').hidden = false;
    if (window.lucide) window.lucide.createIcons();
}

function createScheduleIcs() {
    const title = (document.getElementById('sch-title').value || t('放下手機聚一聚')).trim();
    const timeVal = document.getElementById('sch-time').value;
    const place = (document.getElementById('sch-place').value || '').trim();
    if (!timeVal) { alert(t('請先選聚會時間')); return; }
    const start = new Date(timeVal);
    if (isNaN(start.getTime())) { alert(t('時間格式不正確')); return; }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const esc = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const utc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phubbing//home//TW', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${Date.now()}@phubbing`,
        `DTSTAMP:${utc(new Date())}`,
        `DTSTART:${utc(start)}`,
        `DTEND:${utc(end)}`,
        `SUMMARY:${esc(title)}`,
        place ? `LOCATION:${esc(place)}` : '',
        'DESCRIPTION:' + esc(t('來自 Phubbing：放下手機，好好相聚 🐾')),
        'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    document.getElementById('home-schedule-sheet').hidden = true;
}

// ── utils ──
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
