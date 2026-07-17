import { register, switchView } from '../../core/router.js';
import { apiFetch } from '../../core/api.js';
import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';

// ── 背景 ─────────────────────────────────────────────────────────────────────

const BG_PRESETS = ['default','meadow','night','beach','forest','sunset','snow'];
const BG_KEY     = 'pet_bg';
const BG_IMG_KEY = 'pet_bg_img';
const BG_POS_KEY = 'pet_bg_pos';

const BG_GRADIENTS = {
    meadow: 'linear-gradient(175deg,#c8f5a0 0%,#7ecb57 40%,#4a9e2f 100%)',
    night:  'linear-gradient(175deg,#0d0b2b 0%,#1a1060 45%,#2e1a6e 100%)',
    beach:  'linear-gradient(175deg,#87ceeb 0%,#60b8de 38%,#f5dfa0 70%,#e8c96b 100%)',
    forest: 'linear-gradient(175deg,#1a3a1a 0%,#2d5e2d 45%,#3b7a3b 100%)',
    sunset: 'linear-gradient(175deg,#ff6b35 0%,#f7931e 30%,#ffc93c 60%,#c0392b 100%)',
    snow:   'linear-gradient(175deg,#b8d4f0 0%,#dceeff 45%,#f2f8ff 100%)',
};

let _bgPosX = 50, _bgPosY = 50;
let _bgKey   = 'default';
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
    stage.style.backgroundImage    = '';
    stage.style.backgroundPosition = '';
    stage.style.backgroundSize     = '';
    stage.style.cursor = '';
    if (key === 'custom' && customUrl) {
        stage.style.backgroundImage    = `url("${customUrl.replaceAll('"', '%22')}")`;
        stage.style.backgroundPosition = `${_bgPosX}% ${_bgPosY}%`;
        stage.style.backgroundSize     = 'cover';
        stage.style.cursor = 'grab';
        try {
            localStorage.setItem(BG_IMG_KEY, customUrl);
        } catch {
            showToast('背景圖片太大，無法儲存在此裝置。');
        }
    } else if (BG_GRADIENTS[key]) {
        stage.style.backgroundImage = BG_GRADIENTS[key];
    }
    _bgKey = key;
    localStorage.setItem(BG_KEY, key);
    const hint = document.getElementById('pet-bg-drag-hint');
    if (hint) hint.style.display = key === 'custom' ? 'flex' : 'none';
}

function setupCustomBgDrag() {
    const stage = document.getElementById('pet-stage');
    stage.addEventListener('pointerdown', e => {
        if (_bgKey !== 'custom') return;
        if (e.target.closest('.pet-avatar-wrap,.pet-bg-btn,.pet-speech,.pet-zzz,.pet-poop-wrap')) return;
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
    HAPPY:    ['好開心！好開心！🎉', '你真是個好主人！', '耶！耶！耶！', '汪汪！愛你！'],
    SLEEPING: ['zzz...', '呼呼...', '嗯嗯...'],
    HUNGRY:   ['肚子好餓... 🥺', '可以給我吃點東西嗎？', '嗚嗚... 好餓...'],
    DIRTY:    ['我身上有臭臭... 😭', '快幫我擦一擦！', '好臭好臭！'],
    CRITICAL: ['嗚嗚... 快撐不住了...', '求求你快救我... 💔', '好難受...'],
};

const STATUS_TEXT = { NORMAL:'正常', HAPPY:'開心', HUNGRY:'飢餓', DIRTY:'需清潔', CRITICAL:'危急', SLEEPING:'睡覺' };
const STATUS_EMOJI = { NORMAL:'😊', HAPPY:'🎉', HUNGRY:'😢', DIRTY:'😷', CRITICAL:'💔', SLEEPING:'😴' };

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
let _myPets     = [];
let _pollTimer  = null;
let _actionLock = false;
let _clickIdx   = 0;
// 刪除目標明確落在這裡，confirmDelete 只讀它 —— 不再靠殘留的 _groupPet._isPersonal
// 猜（否則：從列表刪個人寵物會靜默失敗；進過個人寵物再刪群組寵物會誤刪個人寵物）
let _pendingDelete = null;   // { kind: 'personal' | 'group', groupId }
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
    document.getElementById('btn-pet-sleep').onclick = () => {
        const sleeping = Boolean(_groupPet?._raw?.my_pet_is_sleeping);
        doAction(sleeping ? 'wake' : 'sleep');
    };
    const openPersonalPetCreator = () => {
        state.currentGroupDetail = null;
        state.petSwapOrigin = 'personal';
        state.petSwapTarget = state.currentUser
            ? { uid: state.currentUser.uid, nickname: state.currentProfile?.nickname || state.currentUser.displayName || '' }
            : null;
        switchView('view-pet-swap');
    };
    document.getElementById('btn-go-pet-swap').onclick = openPersonalPetCreator;
    document.getElementById('btn-create-personal-pet').onclick = openPersonalPetCreator;
    document.getElementById('btn-pet-tama-back-nopet').onclick = () => {
        if (_entryMode === 'direct') switchView('view-home');
        else showScreen('list');
    };

    document.getElementById('pet-avatar-wrap').addEventListener('click', () => {
        if (_actionLock) return;
        const s = CLICK_CYCLE[_clickIdx % CLICK_CYCLE.length];
        _clickIdx++;
        applyAvatarState(s.anim);
        setSpeech(s.status);
    });

    document.getElementById('btn-pet-rename').onclick     = openRenameDialog;
    document.getElementById('btn-rename-confirm').onclick  = confirmRename;
    document.getElementById('btn-rename-cancel').onclick   = closeRenameDialog;
    document.getElementById('pet-rename-input').addEventListener('keydown', e => {
        if (e.key === 'Enter')  confirmRename();
        if (e.key === 'Escape') closeRenameDialog();
    });

    document.getElementById('btn-pet-delete').onclick = () => openDeleteDialog(
        _groupPet?._isPersonal ? { kind: 'personal' } : { kind: 'group', groupId: _groupId }
    );
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
    } else {
        _entryMode = 'list';
        _groupId   = null;
        _groupPet  = null;
        showLoading(true);
        await loadPetList();
    }
}

function onHide() { stopPolling(); }

// ── 列表模式 ─────────────────────────────────────────────────────────────────

async function loadPetList() {
    try {
        const { data } = await apiFetch('/api/my-pets');
        _myPets = data?.pets || [];
    } catch (e) {
        _myPets = [];
        console.error('load my-pets error', e);
    }
    renderPetList();
    showLoading(false);
}

function renderPetList() {
    const listEl  = document.getElementById('pet-list-cards');
    const emptyEl = document.getElementById('pet-list-empty');
    listEl.innerHTML = '';

    if (!_myPets.length) {
        emptyEl.style.display = 'block';
        showScreen('list');
        return;
    }
    emptyEl.style.display = 'none';

    _myPets.forEach(({ group_id, group_name, is_creator, kind, pet }) => {
        const energy  = pet.pet_energy ?? 50;
        const maxE    = pet.pet_max_energy ?? 100;
        const hp      = pet.pet_hp ?? 5;
        const status  = pet.pet_status || 'NORMAL';
        const isGroup = kind === 'group';

        const card = document.createElement('div');
        card.className = 'pet-list-card';
        card.innerHTML = `
            <img class="pet-list-avatar" src="${escHtml(pet.pet_face_url)}" alt="寵物頭像">
            <div class="pet-list-info">
                <div class="pet-list-name">${escHtml(pet.pet_name || (isGroup ? '群組寵物' : '我的寵物'))}</div>
                <div class="pet-list-group">${escHtml(group_name)}</div>
                <div class="pet-list-status">
                    <span>${STATUS_EMOJI[status] || '😊'} ${STATUS_TEXT[status] || '正常'}</span>
                    <span class="pet-list-energy">⚡ ${energy}/${maxE}</span>
                </div>
                <div class="pet-list-hp">${
                    Array.from({length: 5}, (_, i) =>
                        `<span class="pet-hp-heart${i < hp ? '' : ' empty'}">❤️</span>`
                    ).join('')
                }</div>
            </div>
            <div class="pet-list-btns">
                <button class="btn-care-pet">照顧</button>
                ${is_creator ? `<button class="btn-del-list-pet" title="刪除寵物"><i data-lucide="trash-2"></i></button>` : ''}
            </div>
        `;

        card.querySelector('.btn-care-pet').onclick = () => {
            if (isGroup) {
                enterGroupPet(group_id, is_creator);
            } else {
                enterPersonalPet();
            }
        };
        if (is_creator) {
            card.querySelector('.btn-del-list-pet').onclick = (e) => {
                e.stopPropagation();
                openDeleteDialog(
                    isGroup ? { kind: 'group', groupId: group_id }
                            : { kind: 'personal' }
                );
            };
        }

        listEl.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
    showScreen('list');
}

// ── 單一寵物模式 ──────────────────────────────────────────────────────────────

async function enterPersonalPet() {
    stopPolling();
    _groupId   = null;
    _isCreator = true;
    _groupPet  = null;
    showLoading(true);

    try {
        const { data } = await apiFetch('/api/my-pet');
        const p = data?.pet;
        if (p) {
            _groupPet = {
                pet_face_url:   p.my_pet_image_url,
                pet_name:       p.my_pet_name,
                pet_energy:     p.my_pet_energy,
                pet_max_energy: 100,
                pet_hp:         5,
                pet_status:     p.my_pet_status || 'NORMAL',
                _groupName:     '個人寵物',
                _isPersonal:    true,
                _raw:           p,
            };
        }
    } catch (e) { console.error(e); }

    renderGroupMode();
    showLoading(false);
    startPersonalPolling();
}

let _personalPollTimer = null;
function startPersonalPolling() {
    _personalPollTimer = setInterval(async () => {
        if (_actionLock || _groupId) return;
        try {
            const { data } = await apiFetch('/api/my-pet');
            const p = data?.pet;
            if (p && _groupPet?._isPersonal) {
                _groupPet.pet_energy = p.my_pet_energy;
                _groupPet.pet_status = p.my_pet_status || 'NORMAL';
                _groupPet._raw = p;
                renderGroupMode();
            }
        } catch (_) {}
    }, 60_000);
}

function stopPolling() {
    clearInterval(_pollTimer);         _pollTimer = null;
    clearInterval(_personalPollTimer); _personalPollTimer = null;
}

async function enterGroupPet(groupId, isCreator) {
    stopPolling();
    _groupId   = groupId;
    _isCreator = isCreator;
    _groupPet  = null;
    showLoading(true);
    await loadGroupPet();
    startPolling();
}

async function loadGroupPet() {
    try {
        const [petRes, grpRes] = await Promise.all([
            apiFetch(`/api/groups/${_groupId}/pet`),
            apiFetch(`/api/groups/${_groupId}`),
        ]);
        _groupPet = petRes.data?.pet || null;
        if (_groupPet) {
            _groupPet._groupName = grpRes.data?.group?.name || '群組';
        }
        // 若 direct entry 尚未確認是否為建立者，從群組資料補上
        if (_entryMode === 'direct') {
            const myUid = state.currentUser?.uid;
            _isCreator  = myUid && grpRes.data?.group?.creator_uid === myUid;
        }
    } catch (e) {
        console.error('load group pet error', e);
    }
    renderGroupMode();
    showLoading(false);
}

async function doAction(action) {
    if (_actionLock || !_groupPet?.pet_face_url) return;
    _actionLock = true;
    setAllButtonsDisabled(true);

    const animMap  = { feed: 'eating', wipe: 'wiping', play: 'playing', sleep: 'sleeping', wake: 'happy' };
    const tempAnim = animMap[action];
    if (tempAnim) applyAvatarState(tempAnim);

    try {
        if (_groupPet._isPersonal) {
            const { res, data } = await apiFetch('/api/my-pet/action', {
                method: 'POST',
                body: JSON.stringify({ action }),
            });
            if (!res.ok) throw new Error(data?.detail || '寵物互動失敗');
            if (data?.pet) {
                _groupPet.pet_energy = data.pet.my_pet_energy;
                _groupPet.pet_status = data.pet.my_pet_status || 'NORMAL';
                _groupPet._raw = data.pet;
            }
        } else {
            const { res, data } = await apiFetch(`/api/groups/${_groupId}/pet/action`, {
                method: 'POST',
                body: JSON.stringify({ action }),
            });
            if (!res.ok) throw new Error(data?.detail || '寵物互動失敗');
            if (data?.pet_energy !== undefined && _groupPet) {
                _groupPet.pet_energy      = data.pet_energy;
                _groupPet.pet_happiness   = data.pet_happiness;
                _groupPet.pet_cleanliness = data.pet_cleanliness;
                _groupPet.pet_status      = data.pet_status;
                _groupPet.pet_hp          = data.pet_hp;
            }
        }
    } catch (e) {
        console.error('pet action error', e);
        showToast(e.message || '寵物互動失敗', 'warn');
    }

    await delay(tempAnim ? 680 : 0);
    renderGroupMode();
    setAllButtonsDisabled(false);
    _actionLock = false;
}

function renderGroupMode() {
    if (!_groupPet?.pet_face_url) {
        showScreen('no-pet');
        const personal = !_groupId;
        document.getElementById('pet-no-pet-title').textContent = personal ? '還沒有個人寵物' : '群組還沒有設定寵物臉';
        document.getElementById('pet-no-pet-desc').textContent = personal
            ? '先生成一張寵物臉，再回來養它！'
            : '請先在群組設定頁生成並設定寵物臉！';
        document.getElementById('btn-go-pet-swap').style.display = personal ? '' : 'none';
        return;
    }
    showScreen('game');

    const isPersonal = Boolean(_groupPet._isPersonal);
    document.getElementById('pet-group-badge').style.display = isPersonal ? 'none' : 'inline-flex';
    document.getElementById('pet-group-name').textContent    = _groupPet._groupName || '群組';
    document.getElementById('pet-tama-name').textContent = _groupPet.pet_name || (isPersonal ? '我的寵物' : '群組寵物');

    // 改名：群組建立者才能改
    document.getElementById('btn-pet-rename').style.display = _isCreator ? '' : 'none';
    // 刪除：群組建立者才能刪
    document.getElementById('btn-pet-delete').style.display = _isCreator ? '' : 'none';

    const img = document.getElementById('pet-avatar-img');
    if (img.src !== _groupPet.pet_face_url) img.src = _groupPet.pet_face_url;

    document.getElementById('pet-personal-stats').style.display = isPersonal ? 'block' : 'none';
    document.getElementById('pet-group-stats').style.display    = isPersonal ? 'none' : 'block';

    if (isPersonal) {
        const raw = _groupPet._raw || {};
        const personalStats = {
            hunger: raw.my_pet_hunger ?? 70,
            happiness: raw.my_pet_happiness ?? 70,
            energy: raw.my_pet_energy ?? _groupPet.pet_energy ?? 80,
            clean: raw.my_pet_cleanliness ?? 100,
        };
        Object.entries(personalStats).forEach(([key, value]) => {
            document.getElementById(`fill-${key}`).style.width = `${value}%`;
            document.getElementById(`val-${key}`).textContent = value;
        });
        toggleIcon('pet-poop-icon', Boolean(raw.my_pet_has_poop));
        toggleIcon('pet-pee-icon', Boolean(raw.my_pet_has_pee));
        const sleeping = Boolean(raw.my_pet_is_sleeping);
        document.getElementById('pet-zzz').style.display = sleeping ? 'block' : 'none';
        const sleepButton = document.getElementById('btn-pet-sleep');
        sleepButton.style.display = '';
        sleepButton.querySelector('.icon-sleep').style.display = sleeping ? 'none' : '';
        sleepButton.querySelector('.icon-wake').style.display = sleeping ? '' : 'none';
        sleepButton.querySelector('span').textContent = sleeping ? '叫醒' : '睡覺';

        const status = _groupPet.pet_status || 'NORMAL';
        applyAvatarState(statusToAnimClass(status));
        setSpeech(status);
        return;
    }

    const energy = _groupPet.pet_energy ?? 50;
    const maxE   = _groupPet.pet_max_energy ?? 100;
    const hp     = _groupPet.pet_hp ?? 5;
    document.getElementById('fill-group-energy').style.width = Math.round(energy / maxE * 100) + '%';
    document.getElementById('val-group-energy').textContent  = energy;

    // 快樂／清潔只有群組寵物有（個人寵物走舊的單一 energy 顯示，維持原狀）
    const happiness   = _groupPet.pet_happiness   ?? 0;
    const cleanliness = _groupPet.pet_cleanliness ?? 0;
    document.getElementById('fill-group-happiness').style.width = happiness + '%';
    document.getElementById('val-group-happiness').textContent  = happiness;
    document.getElementById('fill-group-clean').style.width     = cleanliness + '%';
    document.getElementById('val-group-clean').textContent      = cleanliness;
    document.getElementById('fill-group-happiness').closest('.stat-row').style.display = isPersonal ? 'none' : '';
    document.getElementById('fill-group-clean').closest('.stat-row').style.display     = isPersonal ? 'none' : '';

    const heartsEl = document.getElementById('pet-hp-hearts');
    heartsEl.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const s = document.createElement('span');
        s.className = 'pet-hp-heart' + (i < hp ? '' : ' empty');
        s.textContent = '❤️';
        heartsEl.appendChild(s);
    }

    toggleIcon('pet-poop-icon', false);
    toggleIcon('pet-pee-icon',  false);
    document.getElementById('pet-zzz').style.display        = 'none';
    document.getElementById('btn-pet-sleep').style.display  = 'none';

    const status = _groupPet.pet_status || 'NORMAL';
    applyAvatarState(statusToAnimClass(status));
    setSpeech(status);
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
        const path = _groupPet._isPersonal ? '/api/my-pet' : `/api/groups/${_groupId}/pet`;
        const body = _groupPet._isPersonal ? { name } : { pet_name: name };
        const { res, data } = await apiFetch(path, {
            method: 'PATCH',
            body: JSON.stringify(body),
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
    // 依對象換確認文案（個人寵物 vs 群組寵物）
    const isPersonal = _pendingDelete?.kind === 'personal';
    document.getElementById('pet-delete-title').textContent =
        isPersonal ? '確定要刪除個人寵物？' : '確定要刪除群組寵物？';
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
        if (target.kind === 'personal') {
            const { res, data } = await apiFetch('/api/my-pet', { method: 'DELETE' });
            if (!res.ok) throw new Error(data?.detail || '刪除失敗');
        } else if (target.kind === 'group' && target.groupId) {
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
        if (_actionLock || !_groupId) return;
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
}

function showLoading(show) {
    document.getElementById('pet-tama-loading').style.display = show ? 'block' : 'none';
    if (show) {
        document.getElementById('pet-list-screen').style.display = 'none';
        document.getElementById('pet-no-pet').style.display      = 'none';
        document.getElementById('pet-game-wrap').style.display   = 'none';
    }
}

// ── 小工具 ───────────────────────────────────────────────────────────────────

function toggleIcon(id, show) {
    const el = document.getElementById(id);
    if (show) el.classList.add('show');
    else       el.classList.remove('show');
}

function applyAvatarState(cls) {
    document.getElementById('pet-avatar-wrap').className = `pet-avatar-wrap state-${cls}`;
}

function statusToAnimClass(status) {
    return { NORMAL:'idle', HAPPY:'happy', SLEEPING:'sleeping', HUNGRY:'hungry', DIRTY:'dirty', CRITICAL:'critical' }[status] || 'idle';
}

function setSpeech(status) {
    const lines = SPEECHES[status] || SPEECHES.NORMAL;
    document.getElementById('pet-speech').textContent = lines[Math.floor(Math.random() * lines.length)];
}

function setAllButtonsDisabled(disabled) {
    ['btn-pet-feed','btn-pet-wipe','btn-pet-play','btn-pet-sleep'].forEach(id => {
        document.getElementById(id).disabled = disabled;
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
