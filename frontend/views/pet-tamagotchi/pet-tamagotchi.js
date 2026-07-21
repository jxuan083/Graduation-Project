import { register, switchView } from '../../core/router.js';
import { apiFetch } from '../../core/api.js';
import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';

// ── 背景 ─────────────────────────────────────────────────────────────────────

const BG_PRESETS = ['default','meadow','night','beach','forest','sunset','snow'];
const BG_KEY     = 'pet_bg';
const BG_IMG_KEY = 'pet_bg_img';
const BG_POS_KEY = 'pet_bg_pos';

let _bgPosX = 50, _bgPosY = 50;
let _bgDrag  = { active: false, startX: 0, startY: 0, basePosX: 50, basePosY: 50 };

function loadBackground() {
    const saved    = localStorage.getItem(BG_KEY) || 'default';
    const savedImg = localStorage.getItem(BG_IMG_KEY) || null;
    let savedPos = [50, 50];
    try {
        const parsed = JSON.parse(localStorage.getItem(BG_POS_KEY) || '[50,50]');
        if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(Number.isFinite)) savedPos = parsed;
    } catch {
        localStorage.removeItem(BG_POS_KEY);
    }
    _bgPosX = savedPos[0]; _bgPosY = savedPos[1];
    applyBackground(saved, saved === 'custom' ? savedImg : null);
    document.querySelectorAll('.bg-opt[data-bg]').forEach(b => {
        b.classList.toggle('active', b.dataset.bg === saved);
    });
}

function applyBackground(key, customUrl) {
    const stage = document.getElementById('pet-stage');
    if (!stage) return;
    BG_PRESETS.forEach(p => stage.classList.remove(`bg-${p}`));
    stage.classList.remove('bg-custom');
    stage.style.backgroundImage    = '';
    stage.style.backgroundPosition = '';
    stage.style.cursor = '';
    if (key === 'custom' && customUrl) {
        stage.classList.add('bg-custom');
        stage.style.backgroundImage    = `url("${customUrl.replaceAll('"', '%22')}")`;
        stage.style.backgroundPosition = `${_bgPosX}% ${_bgPosY}%`;
        stage.style.cursor = 'grab';
        try {
            localStorage.setItem(BG_IMG_KEY, customUrl);
        } catch {
            showToast('背景圖片太大，無法儲存在此裝置。');
        }
    } else if (key !== 'default') {
        stage.classList.add(`bg-${key}`);
    }
    localStorage.setItem(BG_KEY, key);
    const hint = document.getElementById('pet-bg-drag-hint');
    if (hint) hint.style.display = key === 'custom' ? 'flex' : 'none';
}

function setupCustomBgDrag() {
    const stage = document.getElementById('pet-stage');
    stage.addEventListener('pointerdown', e => {
        if (!stage.classList.contains('bg-custom')) return;
        if (e.target.closest('.pet-avatar-wrap,.pet-bg-btn,.pet-speech')) return;
        _bgDrag.active   = true;
        _bgDrag.startX   = e.clientX;
        _bgDrag.startY   = e.clientY;
        _bgDrag.basePosX = _bgPosX;
        _bgDrag.basePosY = _bgPosY;
        stage.style.cursor = 'grabbing';
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
        if (!_bgDrag.active) return;
        const rect = stage.getBoundingClientRect();
        _bgPosX = Math.max(0, Math.min(100, _bgDrag.basePosX - (e.clientX - _bgDrag.startX) / rect.width  * 120));
        _bgPosY = Math.max(0, Math.min(100, _bgDrag.basePosY - (e.clientY - _bgDrag.startY) / rect.height * 120));
        stage.style.backgroundPosition = `${_bgPosX}% ${_bgPosY}%`;
    });
    stage.addEventListener('pointerup', () => {
        if (!_bgDrag.active) return;
        _bgDrag.active     = false;
        stage.style.cursor = 'grab';
        localStorage.setItem(BG_POS_KEY, JSON.stringify([_bgPosX, _bgPosY]));
    });
}

// ── 台詞 ─────────────────────────────────────────────────────────────────────

const SPEECHES = {
    NORMAL:   ['汪汪！你好！', '今天天氣很好～', '陪我玩嘛～', '我在這裡！'],
    HAPPY:    ['今天狀態超好！', '大家陪我，我很開心！', '再一起完成一場聚會吧！'],
    HUNGRY:   ['肚子有點餓了...', '先吃飽，才有力氣一起玩。'],
    LONELY:   ['好久沒有一起玩了...', '陪我一下嘛。'],
    DIRTY:    ['該整理一下了。', '幫我清潔一下吧！'],
    CRITICAL: ['我現在很需要大家照顧...', '先看看哪個狀態最低。'],
};

const STATUS_META = {
    NORMAL:   { text: '狀態良好', icon: 'circle-check' },
    HAPPY:    { text: '心情很好', icon: 'sparkles' },
    HUNGRY:   { text: '需要餵食', icon: 'utensils' },
    LONELY:   { text: '需要陪伴', icon: 'heart-handshake' },
    DIRTY:    { text: '需要清潔', icon: 'droplets' },
    CRITICAL: { text: '需要照顧', icon: 'triangle-alert' },
};
const STAGE_TEXT = { YOUNG: '幼年期', GROWING: '成長期', PARTNER: '夥伴期' };
const ACCESSORY_META = {
    bell:    { text: '默契鈴鐺', icon: 'bell' },
    bandana: { text: '同行領巾', icon: 'flag-triangle-right' },
    medal:   { text: '聚會勳章', icon: 'medal' },
};
const ACTION_LABELS = { feed: '餵食', wipe: '清潔', play: '玩耍' };

function escHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
}

// ── 狀態 ─────────────────────────────────────────────────────────────────────

let _groupPet   = null;
let _groupId    = null;
let _isCreator  = false;
let _entryMode  = 'list';   // 'list' | 'direct'
let _reactionTimer = null;
let _groupPets  = [];
let _pollTimer  = null;
let _cooldownTimer = null;
let _cooldownTickAt = 0;
let _feedbackTimer = null;
let _actionLock = false;
let _clickIdx   = 0;
let _lastRenderedStatus = null;
let _pendingDelete = null;   // { groupId }
let _deleteBusy    = false;

const CLICK_CYCLE = [
    { anim: 'happy',   status: 'HAPPY'  },
    { anim: 'playing', status: 'NORMAL' },
    { anim: 'idle',    status: 'NORMAL' },
];

// ── 初始化 ───────────────────────────────────────────────────────────────────

export function init() {
    register('view-pet-tamagotchi', {
        element: document.getElementById('view-pet-tamagotchi'),
        onShow,
        onHide,
    });

    // 列表畫面
    document.getElementById('btn-pet-list-back').onclick = () => switchView('view-home');

    // 遊戲畫面
    document.getElementById('btn-pet-tama-back').onclick = () => {
        stopPolling();
        _groupId  = null;
        _groupPet = null;
        if (_entryMode === 'direct') {
            switchView('view-home');
        } else {
            showScreen('list');
        }
    };

    document.getElementById('btn-pet-feed').onclick  = () => doAction('feed');
    document.getElementById('btn-pet-wipe').onclick  = () => doAction('wipe');
    document.getElementById('btn-pet-play').onclick  = () => doAction('play');
    document.getElementById('btn-pet-tama-back-nopet').onclick = () => {
        if (_entryMode === 'direct') switchView('view-home');
        else showScreen('list');
    };
    document.getElementById('btn-pet-retry').onclick = async () => {
        showLoading(true);
        if (_groupId) await loadGroupPet();
        else await loadPetList();
    };

    document.getElementById('pet-avatar-wrap').addEventListener('click', () => {
        if (_actionLock) return;
        const s = CLICK_CYCLE[_clickIdx % CLICK_CYCLE.length];
        _clickIdx++;
        applyAvatarState(s.anim, true);
        playPetMotion('tap');
        playPetReaction('tap', { pet_happiness: 1 });
        setSpeech(s.status);
    });

    document.getElementById('btn-pet-rename').onclick     = openRenameDialog;
    document.getElementById('btn-rename-confirm').onclick  = confirmRename;
    document.getElementById('btn-rename-cancel').onclick   = closeRenameDialog;
    document.getElementById('pet-rename-input').addEventListener('keydown', e => {
        if (e.key === 'Enter')  confirmRename();
        if (e.key === 'Escape') closeRenameDialog();
    });

    document.getElementById('btn-pet-delete').onclick = () => openDeleteDialog({ groupId: _groupId });
    document.getElementById('btn-delete-confirm').onclick  = confirmDelete;
    document.getElementById('btn-delete-cancel').onclick   = closeDeleteDialog;

    // 背景切換
    document.getElementById('btn-change-bg').onclick = () => {
        const picker = document.getElementById('pet-bg-picker');
        picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
    };
    document.querySelectorAll('.bg-opt[data-bg]').forEach(btn => {
        btn.onclick = () => {
            applyBackground(btn.dataset.bg);
            document.querySelectorAll('.bg-opt[data-bg]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('pet-bg-picker').style.display = 'none';
        };
    });
    document.getElementById('bg-upload-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            _bgPosX = 50; _bgPosY = 50;
            applyBackground('custom', ev.target.result);
            document.querySelectorAll('.bg-opt[data-bg]').forEach(b => b.classList.remove('active'));
            document.getElementById('pet-bg-picker').style.display = 'none';
        };
        reader.readAsDataURL(file);
    };

    setupCustomBgDrag();
    document.addEventListener('visibilitychange', refreshWhenVisible);
}

// ── 進入 / 離開 ───────────────────────────────────────────────────────────────

async function onShow() {
    loadBackground();
    const directGroupId = state.tamagotchiGroupId || null;

    if (directGroupId) {
        state.tamagotchiGroupId = null;
        _entryMode  = 'direct';
        _groupId    = directGroupId;
        _isCreator  = false;
        _groupPet   = null;
        showLoading(true);
        await loadGroupPet();
        startPolling();
        startCooldownTicker();
    } else {
        _entryMode = 'list';
        _groupId   = null;
        _groupPet  = null;
        showLoading(true);
        await loadPetList();
    }
}

function onHide() {
    stopPolling();
    clearTimeout(_feedbackTimer);
    _lastRenderedStatus = null;
}

// ── 列表模式 ─────────────────────────────────────────────────────────────────

async function loadPetList() {
    try {
        const { res, data } = await apiFetch('/api/group-pets');
        if (!res.ok) throw new Error(readApiError(data, '群組寵物載入失敗'));
        _groupPets = data?.pets || [];
        renderPetList();
        showLoading(false);
    } catch (e) {
        _groupPets = [];
        console.error('load group-pets error', e);
        showLoadError(e.message);
    }
}

function renderPetList() {
    const listEl  = document.getElementById('pet-list-cards');
    const emptyEl = document.getElementById('pet-list-empty');
    listEl.innerHTML = '';

    if (!_groupPets.length) {
        emptyEl.style.display = 'block';
        showScreen('list');
        if (window.lucide) window.lucide.createIcons();
        return;
    }
    emptyEl.style.display = 'none';

    _groupPets.forEach(({ group_id, group_name, is_creator, pet }, index) => {
        const energy  = pet.pet_energy ?? 50;
        const maxE    = pet.pet_max_energy ?? 100;
        const hp      = pet.pet_hp ?? 5;
        const status  = pet.pet_status || 'NORMAL';
        const statusMeta = STATUS_META[status] || STATUS_META.NORMAL;
        const level = pet.pet_level ?? 1;
        const card = document.createElement('div');
        card.className = 'pet-list-card';
        card.style.setProperty('--pet-card-index', String(Math.min(8, index)));
        card.innerHTML = `
            <img class="pet-list-avatar" src="${escHtml(pet.pet_face_url)}" alt="寵物頭像">
            <div class="pet-list-info">
                <div class="pet-list-name">${escHtml(pet.pet_name || '群組寵物')}<span class="pet-list-level">LV ${level}</span></div>
                <div class="pet-list-group">${escHtml(group_name)}</div>
                <div class="pet-list-status">
                    <span><i data-lucide="${statusMeta.icon}"></i>${statusMeta.text}</span>
                    <span class="pet-list-energy"><i data-lucide="utensils"></i>${energy}/${maxE}</span>
                </div>
                <div class="pet-list-hp">${
                    Array.from({length: 5}, (_, i) =>
                        `<i data-lucide="heart" class="pet-hp-heart${i < hp ? ' is-filled' : ' empty'}"></i>`
                    ).join('')
                }</div>
            </div>
            <div class="pet-list-btns">
                <button class="btn-care-pet">照顧</button>
                ${is_creator ? `<button class="btn-del-list-pet" title="刪除寵物"><i data-lucide="trash-2"></i></button>` : ''}
            </div>
        `;

        card.querySelector('.btn-care-pet').onclick = () => enterGroupPet(group_id, is_creator);
        if (is_creator) {
            card.querySelector('.btn-del-list-pet').onclick = (e) => {
                e.stopPropagation();
                openDeleteDialog({ groupId: group_id });
            };
        }

        listEl.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
    showScreen('list');
}

// ── 單一寵物模式 ──────────────────────────────────────────────────────────────

function stopPolling() {
    clearInterval(_pollTimer);
    _pollTimer = null;
    clearInterval(_cooldownTimer);
    _cooldownTimer = null;
}

async function enterGroupPet(groupId, isCreator) {
    stopPolling();
    _groupId   = groupId;
    _isCreator = isCreator;
    _groupPet  = null;
    showLoading(true);
    await loadGroupPet();
    startPolling();
    startCooldownTicker();
}

async function loadGroupPet() {
    try {
        const [petRes, grpRes] = await Promise.all([
            apiFetch(`/api/groups/${_groupId}/pet`),
            apiFetch(`/api/groups/${_groupId}`),
        ]);
        if (!petRes.res.ok) throw new Error(readApiError(petRes.data, '寵物狀態載入失敗'));
        if (!grpRes.res.ok) throw new Error(readApiError(grpRes.data, '群組資料載入失敗'));
        _groupPet = petRes.data?.pet || null;
        if (_groupPet) {
            _groupPet._groupName = grpRes.data?.group?.name || '群組';
        }
        // 若 direct entry 尚未確認是否為建立者，從群組資料補上
        if (_entryMode === 'direct') {
            const myUid = state.currentUser?.uid;
            _isCreator  = myUid && grpRes.data?.group?.creator_uid === myUid;
        }
        renderGroupMode();
        showLoading(false);
    } catch (e) {
        console.error('load group pet error', e);
        showLoadError(e.message);
    }
}

async function doAction(action) {
    if (_actionLock || !_groupPet?.pet_face_url) return;
    _actionLock = true;
    setAllButtonsDisabled(true);

    const animMap  = { feed: 'eating', wipe: 'wiping', play: 'playing' };
    const tempAnim = animMap[action];
    if (tempAnim) applyAvatarState(tempAnim, true);
    playPetMotion(action);

    try {
        const { res, data } = await apiFetch(`/api/groups/${_groupId}/pet/action`, {
            method: 'POST',
            body: JSON.stringify({ action }),
        });
        if (!res.ok) {
            const remaining = Number(data?.detail?.cooldown_remaining_seconds || 0);
            if (remaining && _groupPet) {
                _groupPet.pet_cooldowns = { ...(_groupPet.pet_cooldowns || {}), [action]: remaining };
            }
            throw new Error(readApiError(data, '寵物互動失敗'));
        }
        if (data?.pet_energy !== undefined && _groupPet) {
            _groupPet.pet_energy      = data.pet_energy;
            _groupPet.pet_happiness   = data.pet_happiness;
            _groupPet.pet_cleanliness = data.pet_cleanliness;
            _groupPet.pet_status      = data.pet_status;
            _groupPet.pet_hp          = data.pet_hp;
            _groupPet.pet_cooldowns   = data.pet_cooldowns || _groupPet.pet_cooldowns || {};
        }
        const changeText = formatChanges(data?.changes || {});
        showActionFeedback(`${ACTION_LABELS[action]}完成${changeText ? ` · ${changeText}` : ''}`, 'success');
        playPetReaction(action, data?.changes || {});
        setSpeech(_groupPet.pet_status || 'NORMAL', true);
    } catch (e) {
        console.error('pet action error', e);
        playPetMotion('nope');
        playPetReaction('nope');
        showActionFeedback(e.message || '寵物互動失敗', 'warn');
        showToast(e.message || '寵物互動失敗', 'warn');
    }

    await delay(tempAnim ? 960 : 0);
    renderGroupMode();
    _actionLock = false;
    renderActionButtons();
}

function renderGroupMode() {
    if (!_groupPet?.pet_face_url) {
        showScreen('no-pet');
        document.getElementById('pet-no-pet-title').textContent = '群組還沒有設定寵物臉';
        document.getElementById('pet-no-pet-desc').textContent = '請先在群組設定頁生成並設定寵物臉！';
        return;
    }
    showScreen('game');

    document.getElementById('pet-group-badge').style.display = 'inline-flex';
    document.getElementById('pet-group-name').textContent    = _groupPet._groupName || '群組';
    document.getElementById('pet-tama-name').textContent = _groupPet.pet_name || '群組寵物';

    const level = Number(_groupPet.pet_level || 1);
    const xpCurrent = Number(_groupPet.pet_xp_current || 0);
    const xpTarget = Number(_groupPet.pet_xp_to_next || 100);
    document.getElementById('pet-level').textContent = level;
    document.getElementById('pet-stage-label').textContent = STAGE_TEXT[_groupPet.pet_stage] || STAGE_TEXT.YOUNG;
    document.getElementById('pet-xp-label').textContent = `${xpCurrent} / ${xpTarget} XP`;
    const xpFill = document.getElementById('pet-xp-fill');
    const xpPercent = Math.max(0, Math.min(100, Math.round(xpCurrent / xpTarget * 100)));
    xpFill.style.transform = `scaleX(${xpPercent / 100})`;
    xpFill.parentElement.setAttribute('aria-valuenow', String(xpPercent));
    document.getElementById('pet-meeting-count').textContent = Number(_groupPet.pet_meetings_completed || 0);
    const lastReward = document.getElementById('pet-last-reward');
    if (_groupPet.pet_last_session_score !== null && _groupPet.pet_last_session_score !== undefined) {
        lastReward.textContent = `上次 +${Number(_groupPet.pet_last_reward_xp || 0)} XP`;
        lastReward.style.display = '';
    } else {
        lastReward.style.display = 'none';
    }
    renderUnlocks(_groupPet.pet_accessories || []);

    // 改名：群組建立者才能改
    document.getElementById('btn-pet-rename').style.display = _isCreator ? '' : 'none';
    // 刪除：群組建立者才能刪
    document.getElementById('btn-pet-delete').style.display = _isCreator ? '' : 'none';

    const img = document.getElementById('pet-avatar-img');
    if (img.src !== _groupPet.pet_face_url) img.src = _groupPet.pet_face_url;

    const energy = _groupPet.pet_energy ?? 50;
    const maxE   = _groupPet.pet_max_energy ?? 100;
    const hp     = _groupPet.pet_hp ?? 5;
    document.getElementById('fill-group-energy').style.width = Math.round(energy / maxE * 100) + '%';
    document.getElementById('val-group-energy').textContent  = energy;

    const happiness   = _groupPet.pet_happiness   ?? 0;
    const cleanliness = _groupPet.pet_cleanliness ?? 0;
    document.getElementById('fill-group-happiness').style.width = happiness + '%';
    document.getElementById('val-group-happiness').textContent  = happiness;
    document.getElementById('fill-group-clean').style.width     = cleanliness + '%';
    document.getElementById('val-group-clean').textContent      = cleanliness;

    const heartsEl = document.getElementById('pet-hp-hearts');
    heartsEl.innerHTML = Array.from({ length: 5 }, (_, i) =>
        `<i data-lucide="heart" class="pet-hp-heart${i < hp ? ' is-filled' : ' empty'}"></i>`
    ).join('');

    const status = _groupPet.pet_status || 'NORMAL';
    const statusMeta = STATUS_META[status] || STATUS_META.NORMAL;
    const statusChip = document.getElementById('pet-status-chip');
    statusChip.className = `pet-status-chip status-${status.toLowerCase()}`;
    statusChip.innerHTML = `<i data-lucide="${statusMeta.icon}"></i><span>${statusMeta.text}</span>`;
    applyAvatarState(statusToAnimClass(status));
    if (_lastRenderedStatus !== status) setSpeech(status, true);
    _lastRenderedStatus = status;
    renderActionButtons();
    if (window.lucide) window.lucide.createIcons();
}

// ── 改名 ──────────────────────────────────────────────────────────────────────

function openRenameDialog() {
    document.getElementById('pet-rename-input').value = _groupPet?.pet_name || '';
    document.getElementById('pet-rename-overlay').style.display = 'flex';
    document.getElementById('pet-rename-input').focus();
}
function closeRenameDialog() {
    document.getElementById('pet-rename-overlay').style.display = 'none';
}
async function confirmRename() {
    const name = document.getElementById('pet-rename-input').value.trim().slice(0, 20);
    closeRenameDialog();
    if (!name || !_groupPet) return;
    try {
        const { res, data } = await apiFetch(`/api/groups/${_groupId}/pet`, {
            method: 'PATCH',
            body: JSON.stringify({ pet_name: name }),
        });
        if (!res.ok) throw new Error(data?.detail || '改名失敗');
        if (_groupPet) _groupPet.pet_name = name;
        document.getElementById('pet-tama-name').textContent = name;
    } catch (e) {
        console.error('rename error', e);
        showToast(e.message || '改名失敗', 'warn');
    }
}

// ── 刪除 ──────────────────────────────────────────────────────────────────────

function openDeleteDialog(target) {
    _pendingDelete = target || null;
    document.getElementById('pet-delete-title').textContent = '確定要刪除群組寵物？';
    document.getElementById('pet-delete-overlay').style.display = 'flex';
}
function closeDeleteDialog() {
    document.getElementById('pet-delete-overlay').style.display = 'none';
}
async function confirmDelete() {
    if (_deleteBusy) return;               // 防連點觸發多次 DELETE
    const target = _pendingDelete;
    if (!target) { closeDeleteDialog(); return; }

    _deleteBusy = true;
    const confirmBtn = document.getElementById('btn-delete-confirm');
    const cancelBtn  = document.getElementById('btn-delete-cancel');
    confirmBtn.disabled = cancelBtn.disabled = true;

    try {
        if (target.groupId) {
            const { res, data } = await apiFetch(`/api/groups/${target.groupId}/pet`, { method: 'DELETE' });
            if (!res.ok) throw new Error(data?.detail || '刪除失敗');
        } else {
            throw new Error('刪除目標無效');
        }
        closeDeleteDialog();
        stopPolling();
        _groupPet = null;
        _groupId  = null;
        _pendingDelete = null;
        showLoading(true);
        await loadPetList();
    } catch (e) {
        console.error('delete pet error', e);
        showToast('刪除失敗，請稍後再試', 'warn');   // 失敗要讓使用者看得到，別靜默
    } finally {
        _deleteBusy = false;
        confirmBtn.disabled = cancelBtn.disabled = false;
    }
}

// ── 輪詢 ──────────────────────────────────────────────────────────────────────

function startPolling() {
    _pollTimer = setInterval(async () => {
        if (_actionLock || !_groupId || document.hidden) return;
        try {
            const { data } = await apiFetch(`/api/groups/${_groupId}/pet`);
            if (data?.pet) { _groupPet = { ..._groupPet, ...data.pet }; renderGroupMode(); }
        } catch (_) {}
    }, 60_000);
}

// ── 畫面切換 ─────────────────────────────────────────────────────────────────

function showScreen(which) {
    document.getElementById('pet-tama-loading').style.display  = 'none';
    document.getElementById('pet-list-screen').style.display   = which === 'list'   ? 'block' : 'none';
    document.getElementById('pet-no-pet').style.display        = which === 'no-pet' ? 'block' : 'none';
    document.getElementById('pet-game-wrap').style.display     = which === 'game'   ? 'flex'  : 'none';
    document.getElementById('pet-tama-error').style.display    = 'none';
}

function showLoading(show) {
    document.getElementById('pet-tama-loading').style.display = show ? 'block' : 'none';
    if (show) {
        document.getElementById('pet-list-screen').style.display = 'none';
        document.getElementById('pet-no-pet').style.display      = 'none';
        document.getElementById('pet-game-wrap').style.display   = 'none';
        document.getElementById('pet-tama-error').style.display  = 'none';
    }
}

// ── 小工具 ───────────────────────────────────────────────────────────────────

function applyAvatarState(cls, restart = false) {
    const avatar = document.getElementById('pet-avatar-wrap');
    if (!avatar) return;
    const nextClass = `state-${cls}`;
    if (restart || !avatar.classList.contains(nextClass)) {
        avatar.className = 'pet-avatar-wrap';
        if (restart) void avatar.offsetWidth;
        avatar.classList.add(nextClass);
    }
}

function playPetReaction(action, changes = {}) {
    const stage = document.getElementById('pet-stage');
    const layer = document.getElementById('pet-reaction-layer');
    if (!stage || !layer) return;

    const reactionClasses = ['reaction-feed', 'reaction-wipe', 'reaction-play', 'reaction-tap', 'reaction-nope'];
    stage.classList.remove(...reactionClasses);
    layer.replaceChildren();
    if (_reactionTimer) clearTimeout(_reactionTimer);

    const reactionClass = `reaction-${action}`;
    void stage.offsetWidth;
    stage.classList.add(reactionClass);

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && action !== 'nope') {
        const vectors = [
            [-52, -54], [-30, -78], [0, -88], [32, -74], [54, -48], [-58, -18], [58, -12],
        ];
        vectors.forEach(([x, y], index) => {
            const particle = document.createElement('span');
            particle.className = `pet-reaction-particle particle-${action}`;
            particle.style.setProperty('--particle-x', `${x}px`);
            particle.style.setProperty('--particle-y', `${y}px`);
            particle.style.setProperty('--particle-delay', `${index * 24}ms`);
            layer.appendChild(particle);
        });

        const positiveChange = Object.entries(changes).find(([, value]) => Number(value) > 0);
        if (positiveChange) {
            const [key, value] = positiveChange;
            const labels = { pet_energy: '飽食', pet_happiness: '快樂', pet_cleanliness: '清潔' };
            const score = document.createElement('span');
            score.className = 'pet-float-score';
            score.textContent = `+${value} ${labels[key] || ''}`.trim();
            layer.appendChild(score);
        }
    }

    _reactionTimer = window.setTimeout(() => {
        stage.classList.remove(reactionClass);
        layer.replaceChildren();
        _reactionTimer = null;
    }, 1050);
}

function playPetMotion(action) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof window.gsap === 'undefined') return;
    const avatar = document.getElementById('pet-avatar-wrap');
    const shadow = document.querySelector('#pet-stage .pet-ground-shadow');
    if (!avatar || !shadow) return;

    const gsap = window.gsap;
    gsap.killTweensOf([avatar, shadow]);
    gsap.set(avatar, { transformOrigin: '50% 100%' });

    const timeline = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        onComplete: () => gsap.set([avatar, shadow], { clearProps: 'transform' }),
    });

    if (action === 'feed') {
        timeline
            .to(avatar, { duration: .11, y: -4, scaleX: .92, scaleY: 1.08 })
            .to(avatar, { duration: .15, y: 8, scaleX: 1.12, scaleY: .88, ease: 'power3.in' })
            .to(avatar, { duration: .14, y: -7, scaleX: .96, scaleY: 1.06, ease: 'back.out(2.2)' })
            .to(avatar, { duration: .13, y: 3, scaleX: 1.06, scaleY: .94 })
            .to(avatar, { duration: .22, y: 0, scaleX: 1, scaleY: 1, ease: 'elastic.out(1,.45)' });
    } else if (action === 'play' || action === 'tap') {
        timeline
            .to(avatar, { duration: .13, y: 5, rotation: -3, scaleX: 1.1, scaleY: .88, ease: 'power2.in' })
            .to(avatar, { duration: .24, y: action === 'play' ? -32 : -20, rotation: 7, scaleX: .94, scaleY: 1.08, ease: 'power3.out' })
            .to(avatar, { duration: .18, y: 3, rotation: -2, scaleX: 1.12, scaleY: .86, ease: 'power2.in' })
            .to(avatar, { duration: .25, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ease: 'elastic.out(1,.42)' });
    } else if (action === 'wipe') {
        timeline
            .to(avatar, { duration: .1, y: 3, scaleX: 1.06, scaleY: .92 })
            .to(avatar, { duration: .14, x: -9, rotation: -8, scaleX: .98, scaleY: 1.03 })
            .to(avatar, { duration: .17, x: 9, rotation: 8, scaleX: 1.02, scaleY: .98 })
            .to(avatar, { duration: .14, x: -5, rotation: -4 })
            .to(avatar, { duration: .23, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ease: 'back.out(2)' });
    } else if (action === 'nope') {
        timeline
            .to(avatar, { duration: .08, x: -7, rotation: -3 })
            .to(avatar, { duration: .1, x: 7, rotation: 3, repeat: 2, yoyo: true })
            .to(avatar, { duration: .16, x: 0, rotation: 0, ease: 'back.out(2)' });
    }

    if (action !== 'nope') {
        timeline
            .to(shadow, { duration: .14, scaleX: 1.14, scaleY: .78, opacity: .25 }, 0)
            .to(shadow, { duration: .25, scaleX: .66, scaleY: .66, opacity: .12 }, .15)
            .to(shadow, { duration: .28, scaleX: 1, scaleY: 1, opacity: .22, ease: 'back.out(2)' }, .48);
    }
}

function statusToAnimClass(status) {
    return { NORMAL:'idle', HAPPY:'happy', HUNGRY:'hungry', LONELY:'hungry', DIRTY:'dirty', CRITICAL:'critical' }[status] || 'idle';
}

function setSpeech(status, force = false) {
    const lines = SPEECHES[status] || SPEECHES.NORMAL;
    const el = document.getElementById('pet-speech');
    if (force || !el.textContent) el.textContent = lines[Math.floor(Math.random() * lines.length)];
}

function setAllButtonsDisabled(disabled) {
    _actionLock = disabled;
    renderActionButtons();
}

function renderActionButtons() {
    const cooldowns = _groupPet?.pet_cooldowns || {};
    for (const action of ['feed', 'wipe', 'play']) {
        const remaining = Math.max(0, Math.ceil(Number(cooldowns[action] || 0)));
        const button = document.getElementById(`btn-pet-${action}`);
        const stateEl = document.getElementById(`pet-${action}-state`);
        button.disabled = _actionLock || remaining > 0;
        button.classList.toggle('is-cooling', remaining > 0);
        stateEl.textContent = remaining > 0 ? formatCooldown(remaining) : '可互動';
    }
}

function startCooldownTicker() {
    clearInterval(_cooldownTimer);
    _cooldownTickAt = Date.now();
    _cooldownTimer = setInterval(() => {
        const now = Date.now();
        const elapsedSeconds = Math.max(1, Math.floor((now - _cooldownTickAt) / 1000));
        _cooldownTickAt = now;
        if (!_groupPet?.pet_cooldowns) return;
        let changed = false;
        for (const action of ['feed', 'wipe', 'play']) {
            const current = Number(_groupPet.pet_cooldowns[action] || 0);
            if (current > 0) {
                _groupPet.pet_cooldowns[action] = Math.max(0, current - elapsedSeconds);
                changed = true;
            }
        }
        if (changed && !document.hidden) renderActionButtons();
    }, 1000);
}

async function refreshWhenVisible() {
    if (document.hidden || !_groupId || _actionLock) return;
    try {
        const { res, data } = await apiFetch(`/api/groups/${_groupId}/pet`);
        if (res.ok && data?.pet) {
            _groupPet = { ..._groupPet, ...data.pet };
            renderGroupMode();
        }
    } catch (_) {}
}

function renderUnlocks(accessories) {
    const wrap = document.getElementById('pet-unlocks');
    const items = document.getElementById('pet-unlock-items');
    const known = accessories.map(key => ACCESSORY_META[key]).filter(Boolean);
    wrap.style.display = known.length ? 'flex' : 'none';
    items.innerHTML = known.map(item =>
        `<span class="pet-unlock-chip"><i data-lucide="${item.icon}"></i>${item.text}</span>`
    ).join('');
}

function showActionFeedback(message, tone = 'success') {
    const el = document.getElementById('pet-action-feedback');
    clearTimeout(_feedbackTimer);
    el.textContent = message;
    el.className = `pet-action-feedback is-visible ${tone === 'warn' ? 'is-warn' : 'is-success'}`;
    _feedbackTimer = setTimeout(() => { el.className = 'pet-action-feedback'; }, 3600);
}

function showLoadError(message) {
    showLoading(false);
    document.getElementById('pet-list-screen').style.display = 'none';
    document.getElementById('pet-no-pet').style.display = 'none';
    document.getElementById('pet-game-wrap').style.display = 'none';
    document.getElementById('pet-error-message').textContent = message || '請檢查網路後再試一次。';
    document.getElementById('pet-tama-error').style.display = 'block';
    if (window.lucide) window.lucide.createIcons();
}

function readApiError(data, fallback) {
    const detail = data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail.message === 'string') return detail.message;
    return fallback;
}

function formatCooldown(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')} 後` : `${rest} 秒後`;
}

function formatChanges(changes) {
    const labels = { pet_energy: '飽食', pet_happiness: '快樂', pet_cleanliness: '清潔' };
    return Object.entries(changes)
        .filter(([, value]) => Number(value) !== 0)
        .map(([key, value]) => `${labels[key] || key} ${Number(value) > 0 ? '+' : ''}${value}`)
        .join('、');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
