// views/home/home.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { events } from '../../core/events.js';
import { startQrScanner } from '../scanner/scanner.js';
import { openMeetingsList } from '../../features/meetings/controller.js';
import { openQuestionBank } from '../question-bank/question-bank.js';
import { openFriendsView } from '../friends/friends.js';
import { openLeaderboardView } from '../../features/leaderboard/controller.js';
import { apiFetch } from '../../core/api.js';
import { t } from '../../core/i18n.js';

const STATUS_BADGE = {
    HAPPY:    '😊',
    NORMAL:   '🐾',
    HUNGRY:   '😟',
    CRITICAL: '😰',
};

export function init() {
    register('view-home', {
        element: document.getElementById('view-home'),
        onShow: () => {
            events.emit('home:show');
            if (state.currentUser) loadGroupPet();
            else {
                // 未登入時隱藏寵物、清快取
                const wrap = document.getElementById('campfire-pet-wrap');
                if (wrap) wrap.style.display = 'none';
            }
        }
    });

    document.getElementById('btn-create-room').onclick = handleCreateRoom;
    document.getElementById('btn-scan-qr').onclick = startQrScanner;
    document.getElementById('btn-open-meetings').onclick = openMeetingsList;
    document.getElementById('btn-open-questions').onclick = openQuestionBank;

    document.getElementById('btn-home-schedule').onclick = openScheduleSheet;
    document.getElementById('btn-sch-cancel').onclick = () => { document.getElementById('home-schedule-sheet').hidden = true; };
    document.getElementById('btn-sch-ics').onclick = createScheduleIcs;

    const btnGroups = document.getElementById('btn-open-groups');
    if (btnGroups) btnGroups.onclick = () => switchView('view-groups');

    const btnLb = document.getElementById('btn-home-leaderboard');
    if (btnLb) btnLb.onclick = openLeaderboardView;

    const btnMyPet = document.getElementById('btn-open-my-pet');
    if (btnMyPet) btnMyPet.onclick = () => {
        state.tamagotchiGroupId = null;
        switchView('view-pet-tamagotchi');
    };

    // 寵物點擊：群組寵物 → 群組 tamagotchi；個人寵物 → 個人 tamagotchi
    const petWrap = document.getElementById('campfire-pet-wrap');
    if (petWrap) petWrap.onclick = () => {
        state.tamagotchiGroupId = state._campfireGroupId || null;
        switchView('view-pet-tamagotchi');
    };

    // 邀請橫幅「查看」按鈕
    const btnBannerView = document.getElementById('btn-incoming-banner-view');
    if (btnBannerView) btnBannerView.onclick = () => openFriendsView('incoming');
}

const LS_PET_KEY = 'campfire_pet_v1';
let _petCacheTs = 0;

// 登入後立刻預載（不等首頁 onShow）
events.on('auth:logged-in', () => { _petCacheTs = 0; loadGroupPet(); });

async function loadGroupPet() {
    const wrap = document.getElementById('campfire-pet-wrap');
    if (!wrap) return;

    // 1. localStorage 快取 → 立刻顯示（跨 session）
    if (!state._campfirePetCache) {
        try {
            const stored = JSON.parse(localStorage.getItem(LS_PET_KEY) || 'null');
            if (stored) { state._campfirePetCache = stored; applyPet(stored, wrap); }
        } catch (_) {}
    } else {
        applyPet(state._campfirePetCache, wrap);
    }

    // 2. 30 秒內不重打 API
    if (Date.now() - _petCacheTs < 30_000) return;

    // 3. 背景更新：先試群組寵物，沒有則 fallback 個人寵物
    try {
        const [grpRes, myRes] = await Promise.all([
            apiFetch('/api/groups'),
            apiFetch('/api/my-pet'),
        ]);
        const groupWithPet = grpRes.data?.groups?.find(g => g.pet_face_url) || null;
        const myPet = myRes.data?.pet;
        const myPetUrl = myPet?.my_pet_image_url || null;

        let petData = null;
        if (groupWithPet) {
            petData = { type: 'group', group_id: groupWithPet.group_id, pet_face_url: groupWithPet.pet_face_url, pet_status: groupWithPet.pet_status };
        } else if (myPetUrl) {
            petData = { type: 'my', pet_face_url: myPetUrl, pet_status: myPet.my_pet_status || 'NORMAL' };
        }

        state._campfirePetCache = petData;
        _petCacheTs = Date.now();
        try { localStorage.setItem(LS_PET_KEY, JSON.stringify(petData)); } catch (_) {}
        applyPet(petData, wrap);
    } catch (_) {}
}

function applyPet(petData, wrap) {
    if (!petData) { wrap.style.display = 'none'; state._campfireGroupId = null; return; }
    state._campfireGroupId = petData.type === 'group' ? petData.group_id : null;
    const img = document.getElementById('campfire-pet-img');
    if (img.src !== petData.pet_face_url) img.src = petData.pet_face_url;
    document.getElementById('campfire-pet-badge').textContent =
        STATUS_BADGE[petData.pet_status] || '🐾';
    wrap.style.display = 'flex';
}

function handleCreateRoom() {
    if (!state.currentUser) {
        alert(t('請先用 Google 登入才能發起聚會'));
        return;
    }
    switchView('view-meeting-setup');
}

// ── 預約聚會：產生 .ics 邀請檔（可加進行事曆、傳給朋友） ──
function openScheduleSheet() {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    t.setSeconds(0, 0);
    const local = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('sch-time').value = local;
    document.getElementById('home-schedule-sheet').hidden = false;
    if (window.lucide) window.lucide.createIcons();
}

function createScheduleIcs() {
    const title = (document.getElementById('sch-title').value || '放下手機聚一聚').trim();
    const timeVal = document.getElementById('sch-time').value;
    const place = (document.getElementById('sch-place').value || '').trim();
    if (!timeVal) { alert('請先選聚會時間'); return; }
    const start = new Date(timeVal);
    if (isNaN(start.getTime())) { alert('時間格式不正確'); return; }
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
        'DESCRIPTION:來自 Phubbing：放下手機，好好相聚 🐾',
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
