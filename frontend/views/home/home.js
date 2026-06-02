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
        }
    });

    document.getElementById('btn-create-room').onclick = handleCreateRoom;
    document.getElementById('btn-scan-qr').onclick = startQrScanner;
    document.getElementById('btn-open-meetings').onclick = openMeetingsList;
    document.getElementById('btn-open-questions').onclick = openQuestionBank;

    const btnGroups = document.getElementById('btn-open-groups');
    if (btnGroups) btnGroups.onclick = () => switchView('view-groups');

    const btnLb = document.getElementById('btn-home-leaderboard');
    if (btnLb) btnLb.onclick = openLeaderboardView;

    const btnMyPet = document.getElementById('btn-open-my-pet');
    if (btnMyPet) btnMyPet.onclick = () => {
        state.tamagotchiGroupId = null;
        switchView('view-pet-tamagotchi');
    };

    // 群組寵物點擊 → 進入群組寵物 tamagotchi
    const petWrap = document.getElementById('campfire-pet-wrap');
    if (petWrap) petWrap.onclick = () => {
        if (state._campfireGroupId) {
            state.tamagotchiGroupId = state._campfireGroupId;
            switchView('view-pet-tamagotchi');
        }
    };

    // 邀請橫幅「查看」按鈕
    const btnBannerView = document.getElementById('btn-incoming-banner-view');
    if (btnBannerView) btnBannerView.onclick = () => openFriendsView('incoming');
}

let _petCacheTs = 0;

async function loadGroupPet() {
    const wrap = document.getElementById('campfire-pet-wrap');
    if (!wrap) return;

    // 先用快取立刻顯示（30 秒內不重打 API）
    if (state._campfirePetCache && Date.now() - _petCacheTs < 30_000) {
        applyGroupPet(state._campfirePetCache, wrap);
        return;
    }

    // 背景靜默更新
    try {
        const { data } = await apiFetch('/api/groups');
        if (!data?.groups) return;
        const groupWithPet = data.groups.find(g => g.pet_face_url) || null;
        state._campfirePetCache = groupWithPet;
        _petCacheTs = Date.now();
        applyGroupPet(groupWithPet, wrap);
    } catch (_) {}
}

function applyGroupPet(groupWithPet, wrap) {
    if (!groupWithPet) {
        wrap.style.display = 'none';
        state._campfireGroupId = null;
        return;
    }
    state._campfireGroupId = groupWithPet.group_id;
    const img = document.getElementById('campfire-pet-img');
    if (img.src !== groupWithPet.pet_face_url) img.src = groupWithPet.pet_face_url;
    document.getElementById('campfire-pet-badge').textContent =
        STATUS_BADGE[groupWithPet.pet_status] || '🐾';
    wrap.style.display = 'flex';
}

function handleCreateRoom() {
    if (!state.currentUser) {
        alert('請先用 Google 登入才能發起聚會');
        return;
    }
    switchView('view-meeting-setup');
}
