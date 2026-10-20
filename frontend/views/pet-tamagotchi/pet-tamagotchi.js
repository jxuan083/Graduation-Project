import { back, register, switchView } from '../../core/router.js';
import { apiFetch } from '../../core/api.js';
import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';
import { isImeComposing } from '../../utils/ime.js';
import { CareCollection, renderCareResult } from '../../features/pets/care-collection.js';
import { careAvailability } from '../../features/pets/care-state.js';
import { t, getLang } from '../../core/i18n.js';

// ── 背景 ─────────────────────────────────────────────────────────────────────

const BG_PRESETS = ['default','terrace','meadow','night','beach','forest','sunset','snow'];
const BG_KEY     = 'pet_bg';
const BG_IMG_KEY = 'pet_bg_img';
const BG_POS_KEY = 'pet_bg_pos';

let _bgPosX = 50, _bgPosY = 50;
let _bgDrag  = { active: false, startX: 0, startY: 0, basePosX: 50, basePosY: 50 };

function scopedBgKey(baseKey) {
    return _groupId ? `${baseKey}:${_groupId}` : baseKey;
}

function readBackgroundSetting(baseKey, fallback = null) {
    return localStorage.getItem(scopedBgKey(baseKey)) ?? localStorage.getItem(baseKey) ?? fallback;
}

function loadBackground() {
    const savedValue = readBackgroundSetting(BG_KEY, 'default');
    const saved    = ['default', 'terrace', 'custom'].includes(savedValue) ? savedValue : 'default';
    const savedImg = readBackgroundSetting(BG_IMG_KEY, null);
    let savedPos = [50, 50];
    try {
        const parsed = JSON.parse(readBackgroundSetting(BG_POS_KEY, '[50,50]'));
        if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(Number.isFinite)) savedPos = parsed;
    } catch {
        localStorage.removeItem(scopedBgKey(BG_POS_KEY));
    }
    _bgPosX = savedPos[0]; _bgPosY = savedPos[1];
    applyBackground(saved, saved === 'custom' ? savedImg : null);
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
            localStorage.setItem(scopedBgKey(BG_IMG_KEY), customUrl);
        } catch {
            showToast('背景圖片太大，無法儲存在此裝置。');
        }
    } else if (key !== 'default') {
        stage.classList.add(`bg-${key}`);
    }
    localStorage.setItem(scopedBgKey(BG_KEY), key);
    document.querySelectorAll('.bg-opt[data-bg]').forEach(b => b.classList.toggle('active', b.dataset.bg === key));
    document.querySelector('.bg-upload-label')?.classList.toggle('active', key === 'custom');
    const uploadPreview = document.getElementById('bg-upload-preview');
    if (uploadPreview && customUrl) uploadPreview.style.backgroundImage = `url("${customUrl.replaceAll('"', '%22')}")`;
    const hint = document.getElementById('pet-bg-drag-hint');
    if (hint) hint.style.display = key === 'custom' ? 'flex' : 'none';
    const resetBtn = document.getElementById('btn-reset-bg-position');
    if (resetBtn) resetBtn.style.display = key === 'custom' ? '' : 'none';
}

function setupCustomBgDrag() {
    const stage = document.getElementById('pet-stage');
    stage.addEventListener('pointerdown', e => {
        if (!stage.classList.contains('bg-custom')) return;
        if (e.target.closest('button,.pet-avatar-wrap,.pet-bg-btn,.pet-speech')) return;
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
    stage.addEventListener('pointercancel', () => { _bgDrag.active = false; stage.style.cursor = 'grab'; });
    stage.addEventListener('pointerup', () => {
        if (!_bgDrag.active) return;
        _bgDrag.active     = false;
        stage.style.cursor = 'grab';
        localStorage.setItem(scopedBgKey(BG_POS_KEY), JSON.stringify([_bgPosX, _bgPosY]));
    });
}

function closeBackgroundPicker() {
    const picker = document.getElementById('pet-bg-picker');
    const button = document.getElementById('btn-change-bg');
    picker.style.display = 'none';
    button.setAttribute('aria-expanded', 'false');
}

function prepareBackgroundImage(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('請選擇圖片檔案'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('無法讀取這張圖片'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('這個圖片格式目前無法使用'));
            image.onload = () => {
                const maxEdge = 1600;
                const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', .84));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
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
    RESCUE:   ['我被困住了…一起開場聚會救我出去！', '我在等大家，完成一場聚會牢籠就會打開。'],
    MEETING_WARNING: ['有點想大家了，這週找時間聚一聚吧。', '好久沒一起專注了，我在等下一場聚會。'],
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

function isLegacyOpaquePet(url) {
    return /\.jpe?g(?:[?#]|$)/i.test(String(url || ''));
}

// ── 狀態 ─────────────────────────────────────────────────────────────────────

let _groupPet   = null;
let _careCatalog = null, _careCollection = null, _drawBusy = false;
const _pendingDraw = new Map();
let _groupId    = null;
let _isCreator  = false;
let _entryMode  = 'list';   // 'list' | 'direct'
let _reactionTimer = null, _releaseTimer = null;
let _groupPets  = [];
let _pollTimer  = null;
let _cooldownTimer = null;
let _cooldownTickAt = 0;
let _feedbackTimer = null;
let _actionLock = false;
let _lastRenderedStatus = null;
let _pendingDelete = null;   // { groupId }
let _petViewer = null;
let _viewerKey = null;
let _viewerVersion = 0;
let _deleteBusy    = false;
let _renameBusy    = false;
let _viewActive = false, _screenSeq = 0, _pollBusy = false, _adoptBusy = false;
const _requests = new Set(), _pendingCare = new Map();
function careKey() { return `${state.currentUser?.uid || ''}:${_groupId}`; }
async function petRequest(path, options = {}) {
    const controller = new AbortController(); _requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 12000);
    try { return await apiFetch(path, { ...options, signal: controller.signal }); }
    catch (error) {
        if (error.name === 'AbortError' && _viewActive) throw new Error('連線逾時，尚未確認結果，請重試確認。');
        throw error;
    } finally { clearTimeout(timer); _requests.delete(controller); }
}
function sameScreen(seq, groupId = _groupId) { return _viewActive && seq === _screenSeq && groupId === _groupId; }


// ── 初始化 ───────────────────────────────────────────────────────────────────

export function init() {
    register('view-pet-tamagotchi', {
        element: document.getElementById('view-pet-tamagotchi'),
        onShow,
        onHide,
    });

    // 列表畫面
    document.getElementById('btn-pet-list-back').onclick = back;

    // 遊戲畫面
    document.getElementById('btn-pet-tama-back').onclick = () => {
        _screenSeq++; disposePetViewer(); stopPolling(); resetSceneFeedback();
        _groupId  = null;
        _groupPet = null;
        if (_entryMode === 'direct') {
            back();
        } else {
            showScreen('list');
        }
    };

    _careCollection = new CareCollection(document.getElementById('pet-care-shop'), {
        onDraw: drawCareItem, onUse: doAction,
        availability: action => careAvailability(_groupPet, action, {busy: _actionLock || _petViewer?.busy || Boolean(_pendingCare.get(careKey())), pending: _pendingCare.get(careKey())?.action}),
    });
    document.getElementById('btn-pet-draw').onclick = () => { syncCareCollection(); _careCollection.open('draw'); };
    document.getElementById('btn-pet-bag').onclick = () => { syncCareCollection(); _careCollection.open('bag'); };
    document.getElementById('btn-pet-feed').onclick  = () => doAction('feed');
    document.getElementById('btn-pet-wipe').onclick  = () => doAction('wipe');
    document.getElementById('btn-pet-play').onclick  = () => doAction('play');
    document.getElementById('btn-pet-tama-back-nopet').onclick = () => {
        if (_entryMode === 'direct') back();
        else showScreen('list');
    };
    document.getElementById('btn-pet-retry').onclick = async () => {
        showLoading(true);
        if (_groupId) await loadGroupPet();
        else await loadPetList();
    };

    document.getElementById('pet-avatar-wrap').addEventListener('click', touchPet);
    const touch = document.getElementById('btn-pet-touch');
    touch.onclick = touchPet;
    touch.onpointermove = event => {
        if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        const rect = document.getElementById('pet-stage').getBoundingClientRect();
        _petViewer?.setAttention((event.clientX - rect.left) / rect.width * 2 - 1);
    };
    touch.onpointerleave = () => _petViewer?.setAttention();
    document.getElementById('btn-pet-adopt').onclick = openAdoptDialog;
    document.getElementById('btn-pet-character').onclick = openAdoptDialog;
    document.getElementById('btn-pet-adopt-cancel').onclick = () => document.getElementById('pet-adopt-dialog').close();
    document.getElementById('pet-adopt-form').onsubmit = adoptPet;
    document.getElementById('pet-adopt-dialog').addEventListener('cancel', event => { if (_adoptBusy) event.preventDefault(); });
    document.getElementById('btn-pet-animation-retry').onclick = () => { disposePetViewer(); syncPetViewer(); };
    document.getElementById('pet-avatar-wrap').addEventListener('pointermove', event => {
        const rect = event.currentTarget.getBoundingClientRect();
        _petViewer?.setAttention((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
    });
    document.getElementById('pet-avatar-wrap').addEventListener('pointerleave', () => _petViewer?.setAttention());

    document.getElementById('btn-pet-rename').onclick     = openRenameDialog;
    document.getElementById('btn-rename-confirm').onclick  = confirmRename;
    document.getElementById('btn-rename-cancel').onclick   = closeRenameDialog;
    document.getElementById('pet-rename-input').addEventListener('keydown', e => {
        if (isImeComposing(e)) return;   // 輸入法選字中的 Enter 不確認改名
        if (e.key === 'Enter')  confirmRename();
        if (e.key === 'Escape') closeRenameDialog();
    });

    document.getElementById('btn-pet-delete').onclick = () => openDeleteDialog({ groupId: _groupId });
    document.getElementById('btn-delete-confirm').onclick  = confirmDelete;
    document.getElementById('btn-delete-cancel').onclick   = closeDeleteDialog;

    // 背景切換
    document.getElementById('btn-change-bg').onclick = () => {
        const picker = document.getElementById('pet-bg-picker');
        const opening = picker.style.display === 'none';
        picker.style.display = opening ? 'block' : 'none';
        document.getElementById('btn-change-bg').setAttribute('aria-expanded', String(opening));
    };
    document.getElementById('btn-close-bg-picker').onclick = closeBackgroundPicker;
    document.querySelectorAll('.bg-opt[data-bg]').forEach(btn => {
        btn.onclick = () => {
            applyBackground(btn.dataset.bg);
            closeBackgroundPicker();
        };
    });
    document.getElementById('btn-reset-bg-position').onclick = () => {
        _bgPosX = 50; _bgPosY = 50;
        document.getElementById('pet-stage').style.backgroundPosition = '50% 50%';
        localStorage.setItem(scopedBgKey(BG_POS_KEY), '[50,50]');
        showToast('背景構圖已重設');
    };
    document.getElementById('bg-upload-input').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const uploadTile = document.querySelector('.bg-upload-label');
        uploadTile.classList.add('is-loading');
        try {
            const imageUrl = await prepareBackgroundImage(file);
            _bgPosX = 50; _bgPosY = 50;
            applyBackground('custom', imageUrl);
            closeBackgroundPicker();
        } catch (error) {
            showToast(error.message || '背景處理失敗', 'warn');
        } finally {
            uploadTile.classList.remove('is-loading');
            e.target.value = '';
        }
    };

    document.getElementById('pet-rename-overlay').addEventListener('cancel', event => { if (_renameBusy) event.preventDefault(); });
    document.getElementById('pet-delete-overlay').addEventListener('cancel', event => { if (_deleteBusy) event.preventDefault(); });
    setupCustomBgDrag();
    document.addEventListener('visibilitychange', refreshWhenVisible);
}

// ── 進入 / 離開 ───────────────────────────────────────────────────────────────

async function onShow() {
    _viewActive = true; _screenSeq++; _actionLock = false; resetSceneFeedback();
    const chooseCharacter = Boolean(state.tamagotchiChooseCharacter); state.tamagotchiChooseCharacter = false;
    const directGroupId = state.tamagotchiGroupId || null;

    if (directGroupId) {
        state.tamagotchiGroupId = null;
        _entryMode  = 'direct';
        _groupId    = directGroupId;
        _isCreator  = false;
        _groupPet   = null;
        loadBackground();
        showLoading(true);
        await loadGroupPet();
        if (!_viewActive) return;
        if (chooseCharacter) openAdoptDialog();
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
    _viewActive = false; _screenSeq++; _actionLock = false;
    for (const request of _requests) request.abort();
    document.getElementById('pet-adopt-dialog').close();
    document.getElementById('pet-rename-overlay').close();
    document.getElementById('pet-delete-overlay').close();
    resetSceneFeedback();
    _pendingDelete = null;

    disposePetViewer();
    stopPolling();
    clearTimeout(_feedbackTimer);
    _lastRenderedStatus = null;
}

// ── 列表模式 ─────────────────────────────────────────────────────────────────

async function loadPetList() {
    const seq = _screenSeq;
    try {
        const { res, data } = await petRequest('/api/group-pets');
        if (!sameScreen(seq)) return;
        if (!res.ok) throw new Error(readApiError(data, '群組寵物載入失敗'));
        _groupPets = data?.pets || [];
        renderPetList();
        showLoading(false);
    } catch (e) {
        if (!sameScreen(seq)) return;
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

    _groupPets.forEach(({ group_id, group_name, is_creator, pet = {} }, index) => {
        if (!pet?.pet_face_url) {
            const card = document.createElement('article'); card.className = 'pet-list-adopt-card';
            card.innerHTML = `<img src="./assets/pets/illustrated/puppy-poster-v1.png" alt="等待領養的狗狗"><div><span>${escHtml(group_name)}</span><h3>一起迎接小夥伴</h3><p>${is_creator ? '領養後，大家就能一起照顧牠。' : '邀請群組建立者來領養一隻寵物。'}</p><button class="btn secondary" type="button">${is_creator ? '領養寵物' : '查看群組寵物'}</button></div>`;
            card.querySelector('button').onclick = () => enterGroupPet(group_id, is_creator);
            listEl.appendChild(card); return;
        }
        const energy  = pet.pet_energy ?? 50;
        const maxE    = pet.pet_max_energy ?? 100;
        const status  = pet.pet_status || 'NORMAL';
        const statusMeta = STATUS_META[status] || STATUS_META.NORMAL;
        const level = pet.pet_level ?? 1;
        const isCaged = Boolean(pet.pet_is_caged);
        const meetingWarning = Boolean(pet.pet_meeting_warning);
        const visitorEntry = index === 0 && _groupPets.length > 1 && _groupPets[1].pet?.pet_face_url ? _groupPets[1] : null;
        const sceneClass = index % 2 === 0 ? 'scene-sunroom' : 'scene-terrace';
        const card = document.createElement('article');
        card.className = 'pet-list-card';
        card.style.setProperty('--pet-card-index', String(Math.min(8, index)));
        card.innerHTML = `
            <div class="pet-list-scene ${sceneClass}${isCaged ? ' is-caged' : ''}">
                <span class="pet-list-scene-label">${index % 2 === 0 ? '晨光起居室' : '黃昏露台'}</span>
                <div class="pet-list-pet-wrap">
                    <img class="pet-list-avatar${isLegacyOpaquePet(pet.pet_face_url) ? ' pet-legacy-opaque' : ''}" src="${escHtml(pet.pet_face_url)}" alt="${escHtml(pet.pet_name || '群組寵物')}">
                </div>
                ${visitorEntry && !isCaged ? `
                    <div class="pet-list-visitor" aria-label="${escHtml(t('{name}來串門', { name: visitorEntry.pet.pet_name || t('另一隻寵物') }))}">
                        <img class="${isLegacyOpaquePet(visitorEntry.pet.pet_face_url) ? 'pet-legacy-opaque' : ''}" src="${escHtml(visitorEntry.pet.pet_face_url)}" alt="">
                        <span>${escHtml(t('{name}來串門', { name: visitorEntry.pet.pet_name || t('朋友') }))}</span>
                    </div>` : ''}
                ${isCaged ? `<div class="pet-list-cage" aria-hidden="true"><span></span><span></span><span></span><span></span></div>` : ''}
            </div>
            <div class="pet-list-body">
                <div class="pet-list-info">
                    <div class="pet-list-group">${escHtml(group_name)}</div>
                    <div class="pet-list-name">${escHtml(pet.pet_name || '群組寵物')}<span class="pet-list-level">LV ${level}</span></div>
                    <div class="pet-list-status${isCaged ? ' status-rescue' : ''}">
                        <span><i data-lucide="${isCaged ? 'lock-keyhole' : (meetingWarning ? 'calendar-clock' : statusMeta.icon)}"></i>${isCaged ? '等待大家開一場聚會救援' : (meetingWarning ? escHtml(t('{n} 天後需要救援', { n: Number(pet.pet_days_until_caged || 0) })) : statusMeta.text)}</span>
                        ${isCaged ? '' : `<span class="pet-list-energy"><i data-lucide="utensils"></i>${energy}/${maxE}</span>`}
                    </div>
                </div>
                <div class="pet-list-btns">
                    <button class="btn-care-pet">${isCaged ? '去救援' : '進入'}<i data-lucide="arrow-up-right"></i></button>
                    ${is_creator ? `<button class="btn-del-list-pet" title="刪除寵物"><i data-lucide="trash-2"></i></button>` : ''}
                </div>
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
    _screenSeq++; disposePetViewer(); stopPolling(); resetSceneFeedback();
    _groupId   = groupId;
    _isCreator = isCreator;
    _groupPet  = null;
    loadBackground();
    showLoading(true);
    await loadGroupPet();
    if (!_viewActive) return;
    startPolling();
    startCooldownTicker();
}

async function loadGroupPet() {
    const seq = _screenSeq, groupId = _groupId;
    try {
        const [petRes, grpRes] = await Promise.all([
            petRequest(`/api/groups/${groupId}/pet`),
            petRequest(`/api/groups/${groupId}`),
        ]);
        if (!sameScreen(seq, groupId)) return;
        if (!petRes.res.ok) throw new Error(readApiError(petRes.data, '寵物狀態載入失敗'));
        if (!grpRes.res.ok) throw new Error(readApiError(grpRes.data, '群組資料載入失敗'));
        _groupPet = petRes.data?.pet || null;
        _careCatalog = petRes.data?.care_catalog || null;
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
        if (!sameScreen(seq, groupId)) return;
        console.error('load group pet error', e);
        showLoadError(e.message);
    }
}

async function doAction(action, itemId) {
    const pending = _pendingCare.get(careKey());
    const availability = careAvailability(_groupPet, action, { busy: _actionLock || _petViewer?.busy, pending: pending?.action });
    if (availability.disabled) return;
    const seq = _screenSeq, groupId = _groupId, key = careKey();
    const request = pending || { action, item_id: itemId, request_id: (crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('')) };
    _pendingCare.set(key, request); _actionLock = true; renderActionButtons();
    showActionFeedback('正在確認這次互動…', 'pending');
    let confirmed = false;
    try {
        const { res, data } = await petRequest(`/api/groups/${groupId}/pet/action`, { method: 'POST', body: JSON.stringify(request) });
        if (!res.ok) {
            if (res.status < 500) _pendingCare.delete(key);
            if (!sameScreen(seq, groupId)) return;
            const remaining = Number(data?.detail?.cooldown_remaining_seconds || 0);
            if (remaining) _groupPet.pet_cooldowns = { ..._groupPet.pet_cooldowns, [action]: remaining };
            throw new Error(readApiError(data, '寵物互動失敗'));
        }
        confirmed = true; _pendingCare.delete(key);
        if (!sameScreen(seq, groupId)) return;
        for (const field of ['pet_energy','pet_happiness','pet_cleanliness','pet_status','pet_hp','pet_cooldowns','pet_discovered_items','pet_last_care','pet_last_toy','pet_coins','pet_food_inventory','pet_owned_toys']) {
            if (data?.[field] !== undefined) _groupPet[field] = data[field];
        }
        showActionFeedback(`${t('{action}完成', { action: t(ACTION_LABELS[action]) })} · ${formatChanges(data?.changes || {})}`, 'success');
        playPetReaction(action, data?.replayed ? {} : data?.changes || {});
        renderCareResult(document.getElementById('pet-care-result'), data?.care_item, `${t(action === 'feed' ? '這次吃的是' : '這次玩的是')} · ${formatChanges(data?.changes || {})}`);
        syncCareCollection();
        if (!data?.replayed) {
            if (_petViewer?.loaded) await _petViewer.playAndWait(action, data?.care_item);
            else { applyAvatarState({ feed: 'eating', wipe: 'wiping', play: 'playing' }[action], true); await delay(900); }
        }
        if (sameScreen(seq, groupId)) setSpeech(_groupPet.pet_status || 'NORMAL', true);
    } catch (error) {
        if (!sameScreen(seq, groupId)) return;
        const uncertain = _pendingCare.has(key);
        showActionFeedback(uncertain ? '尚未確認結果，請按原按鈕重試，沿用同一筆操作確認。' : error.message, 'warn');
        if (!uncertain) playPetReaction('nope');
    } finally {
        if (sameScreen(seq, groupId)) {
            _actionLock = false; renderGroupMode();
            document.getElementById('pet-sync-status').textContent = confirmed ? '已同步群組狀態' : (_pendingCare.has(key) ? '結果待確認，其他照顧操作暫停' : '');
        }
    }
}

function renderGroupMode() {
    if (!_groupPet?.pet_face_url) {
        showScreen('no-pet');
        document.getElementById('pet-no-pet-title').textContent = '迎接你們的小夥伴';
        document.getElementById('btn-pet-adopt').hidden = !_isCreator;
        document.getElementById('pet-no-pet-desc').textContent = _isCreator ? '不用上傳照片，領養後就能和大家一起照顧牠。' : '請群組建立者來領養，之後每位成員都能一起照顧牠。';
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
        lastReward.textContent = t('上次 +{n} XP', { n: Number(_groupPet.pet_last_reward_xp || 0) });
        lastReward.style.display = '';
    } else {
        lastReward.style.display = 'none';
    }
    renderUnlocks(_groupPet.pet_accessories || []);

    // 改名：群組建立者才能改
    document.getElementById('btn-pet-rename').style.display = _isCreator ? '' : 'none';
    document.getElementById('btn-pet-character').style.display = _isCreator && _groupPet.pet_character_id !== 'puppy-v1' ? '' : 'none';
    // 刪除：群組建立者才能刪
    document.getElementById('btn-pet-delete').style.display = _isCreator ? '' : 'none';

    const img = document.getElementById('pet-avatar-img');
    if (img.getAttribute('src') !== _groupPet.pet_face_url) img.src = _groupPet.pet_face_url;
    syncPetViewer();
    img.classList.toggle('pet-legacy-opaque', isLegacyOpaquePet(_groupPet.pet_face_url));

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

    for (const [key, value, label] of [['energy', energy, '飽食'], ['happiness', happiness, '快樂'], ['clean', cleanliness, '清潔']]) {
        const bar = document.getElementById(`fill-group-${key}`).parentElement;
        bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', label);
        bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(value));
    }
    const heartsEl = document.getElementById('pet-hp-hearts');
    heartsEl.innerHTML = Array.from({ length: 5 }, (_, i) =>
        `<i data-lucide="heart" class="pet-hp-heart${i < hp ? ' is-filled' : ' empty'}"></i>`
    ).join('');

    const status = _groupPet.pet_status || 'NORMAL';
    const isCaged = Boolean(_groupPet.pet_is_caged);
    const meetingWarning = Boolean(_groupPet.pet_meeting_warning);
    const rescueMemoryKey = `pet-was-caged:${_groupId}`;
    const shouldPlayRelease = !isCaged && localStorage.getItem(rescueMemoryKey) === '1';
    const statusMeta = STATUS_META[status] || STATUS_META.NORMAL;
    const statusChip = document.getElementById('pet-status-chip');
    const stage = document.getElementById('pet-stage');
    const rescueOverlay = document.getElementById('pet-rescue-overlay');
    stage.classList.toggle('is-caged', isCaged);
    rescueOverlay.style.display = isCaged ? 'block' : 'none';
    if (isCaged) {
        localStorage.setItem(rescueMemoryKey, '1');
        statusChip.className = 'pet-status-chip status-rescue';
        statusChip.innerHTML = '<i data-lucide="lock-keyhole"></i><span>等待救援</span>';
        applyAvatarState('rescue');
        if (_lastRenderedStatus !== 'RESCUE') setSpeech('RESCUE', true);
        _lastRenderedStatus = 'RESCUE';
    } else if (meetingWarning) {
        localStorage.removeItem(rescueMemoryKey);
        statusChip.className = 'pet-status-chip status-warning';
        statusChip.innerHTML = `<i data-lucide="calendar-clock"></i><span>${escHtml(t('{n} 天後需要救援', { n: Number(_groupPet.pet_days_until_caged || 0) }))}</span>`;
        applyAvatarState(statusToAnimClass(status));
        if (_lastRenderedStatus !== 'MEETING_WARNING') setSpeech('MEETING_WARNING', true);
        _lastRenderedStatus = 'MEETING_WARNING';
    } else {
        localStorage.removeItem(rescueMemoryKey);
        statusChip.className = `pet-status-chip status-${status.toLowerCase()}`;
        statusChip.innerHTML = `<i data-lucide="${statusMeta.icon}"></i><span>${statusMeta.text}</span>`;
        applyAvatarState(statusToAnimClass(status));
        if (_lastRenderedStatus !== status) setSpeech(status, true);
        _lastRenderedStatus = status;
    }
    syncCareCollection();
    renderActionButtons();
    if (window.lucide) window.lucide.createIcons();
    if (shouldPlayRelease) playPetRelease();
}

function playPetRelease() {
    const stage = document.getElementById('pet-stage');
    const overlay = document.getElementById('pet-rescue-overlay');
    const copy = overlay?.querySelector('.pet-rescue-copy');
    if (!stage || !overlay || !copy || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    copy.innerHTML = '<strong>救援成功</strong><span>聚會讓牢籠打開了，歡迎回來</span>';
    overlay.style.display = 'block';
    overlay.classList.remove('is-releasing');
    void overlay.offsetWidth;
    overlay.classList.add('is-releasing');
    playPetMotion('play');
    playPetReaction('play');
    const seq = _screenSeq; clearTimeout(_releaseTimer);
    _releaseTimer = window.setTimeout(() => {
        if (!sameScreen(seq)) return;
        overlay.style.display = 'none';
        overlay.classList.remove('is-releasing');
        copy.innerHTML = '<strong>等你們來救我</strong><span>完成一場群組聚會，牢籠就會打開</span>';
    }, 1250);
}

// ── 改名 ──────────────────────────────────────────────────────────────────────

function openRenameDialog() {
    if (_renameBusy || _actionLock || _petViewer?.busy) return;
    document.getElementById('pet-rename-input').value = _groupPet?.pet_name || '';
    document.getElementById('pet-rename-overlay').showModal();
    document.getElementById('pet-rename-input').focus();
}
function closeRenameDialog() {
    if (_renameBusy) return;
    document.getElementById('pet-rename-overlay').close();
}
async function confirmRename() {
    if (_renameBusy || !_groupPet) return;
    const input = document.getElementById('pet-rename-input');
    const button = document.getElementById('btn-rename-confirm');
    const name = input.value.trim().slice(0, 20);
    if (!name) {
        input.setCustomValidity('請輸入寵物名字');
        input.reportValidity();
        input.focus();
        return;
    }
    input.setCustomValidity('');
    const seq = _screenSeq, groupId = _groupId;
    _renameBusy = true;
    button.disabled = true;
    button.textContent = '儲存中…';
    try {
        const { res, data } = await petRequest(`/api/groups/${groupId}/pet`, {
            method: 'PATCH',
            body: JSON.stringify({ pet_name: name }),
        });
        if (!sameScreen(seq, groupId)) return;
        if (!res.ok) throw new Error(readApiError(data, '改名失敗'));
        if (_groupPet) _groupPet.pet_name = name;
        document.getElementById('pet-tama-name').textContent = name;
        document.getElementById('pet-rename-overlay').close();
        showToast('名字已更新');
    } catch (e) {
        if (!sameScreen(seq, groupId)) return;
        console.error('rename error', e);
        showToast(e.message || '改名失敗', 'warn');
    } finally {
        _renameBusy = false;
        button.disabled = false;
        button.textContent = '確認';
    }
}

// ── 刪除 ──────────────────────────────────────────────────────────────────────

function openDeleteDialog(target) {
    if (_actionLock || _petViewer?.busy) return;
    _pendingDelete = target || null;
    document.getElementById('pet-delete-title').textContent = '確定要刪除群組寵物？';
    document.getElementById('pet-delete-overlay').showModal();
}
function closeDeleteDialog() {
    document.getElementById('pet-delete-overlay').close();
}
async function confirmDelete() {
    if (_deleteBusy) return;               // 防連點觸發多次 DELETE
    const target = _pendingDelete;
    if (!target) { closeDeleteDialog(); return; }

    const seq = _screenSeq;
    _deleteBusy = true;
    const confirmBtn = document.getElementById('btn-delete-confirm');
    const cancelBtn  = document.getElementById('btn-delete-cancel');
    confirmBtn.disabled = cancelBtn.disabled = true;

    try {
        if (target.groupId) {
            const { res, data } = await petRequest(`/api/groups/${target.groupId}/pet`, { method: 'DELETE' });
            if (!res.ok) throw new Error(data?.detail || '刪除失敗');
        } else {
            throw new Error('刪除目標無效');
        }
        if (!sameScreen(seq)) return;
        closeDeleteDialog();
        stopPolling();
        _groupPet = null;
        _groupId  = null;
        _pendingDelete = null;
        showLoading(true);
        await loadPetList();
    } catch (e) {
        if (!sameScreen(seq)) return;
        console.error('delete pet error', e);
        showToast('刪除失敗，請稍後再試', 'warn');   // 失敗要讓使用者看得到，別靜默
    } finally {
        _deleteBusy = false;
        confirmBtn.disabled = cancelBtn.disabled = false;
    }
}

// ── 輪詢 ──────────────────────────────────────────────────────────────────────

function startPolling() {
    clearInterval(_pollTimer); _pollTimer = setInterval(refreshWhenVisible, 60_000);
}

// ── 畫面切換 ─────────────────────────────────────────────────────────────────

function showScreen(which) {
    if (which !== 'game') disposePetViewer();
    document.getElementById('pet-tama-loading').style.display  = 'none';
    document.getElementById('pet-list-screen').style.display   = which === 'list'   ? 'block' : 'none';
    document.getElementById('pet-no-pet').style.display        = which === 'no-pet' ? 'block' : 'none';
    document.getElementById('pet-game-wrap').style.display     = which === 'game'   ? 'flex'  : 'none';
    document.getElementById('pet-tama-error').style.display    = 'none';
}

function showLoading(show) {
    if (show) disposePetViewer();
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
    _petViewer?.setStatus(cls.toUpperCase());
    const avatar = document.getElementById('pet-avatar-wrap');
    if (!avatar) return;
    const nextClass = `state-${cls}`;
    if (restart || !avatar.classList.contains(nextClass)) {
        avatar.className = 'pet-avatar-wrap';
        if (restart) void avatar.offsetWidth;
        avatar.classList.add(nextClass);
    }
}

function resetSceneFeedback() {
    document.getElementById('pet-care-shop')?.close();
    renderCareResult(document.getElementById('pet-care-result'), null, '');
    renderCareResult(document.querySelector('[data-shop-result]'), null, '');
    document.getElementById('pet-draw-status').textContent = '';
    clearTimeout(_reactionTimer); clearTimeout(_releaseTimer); clearTimeout(_feedbackTimer);
    _reactionTimer = _releaseTimer = _feedbackTimer = null;
    const stage = document.getElementById('pet-stage');
    for (const cls of [...stage.classList]) if (cls.startsWith('reaction-')) stage.classList.remove(cls);
    document.getElementById('pet-reaction-layer').replaceChildren();
    document.getElementById('pet-rescue-overlay').classList.remove('is-releasing');
    document.querySelector('.pet-rescue-copy').innerHTML = '<strong>等你們來救我</strong><span>完成一場群組聚會，牢籠就會打開</span>';
    document.getElementById('pet-action-feedback').className = 'pet-action-feedback';
    document.getElementById('pet-action-feedback').textContent = '';
    document.getElementById('pet-sync-status').textContent = '';
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
    if (_petViewer) {
        if (action === 'tap' || action === 'release') _petViewer.play('pet');
        return;
    }
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

function disposePetViewer() {
    _viewerVersion++; _petViewer?.dispose(); _petViewer = null; _viewerKey = null;
    document.getElementById('pet-stage')?.classList.remove('has-3d-pet', 'has-illustrated-pet', 'illustrated-ready');
    document.getElementById('btn-pet-touch').hidden = true;
    document.getElementById('pet-viewer-status').hidden = true;
    document.getElementById('btn-pet-animation-retry').hidden = true;
}
async function syncPetViewer() {
    // Existing photo characters retain their saved image; new roles use Rive.
    if (_groupPet?.pet_character_id !== 'puppy-v1') { if (_viewerKey) disposePetViewer(); return; }
    const key = `${_groupId}:puppy-v1`;
    if (_viewerKey === key) return;
    disposePetViewer(); _viewerKey = key;
    const version = _viewerVersion, stage = document.getElementById('pet-stage');
    const status = document.getElementById('pet-viewer-status'), retry = document.getElementById('btn-pet-animation-retry');
    stage.classList.add('has-illustrated-pet'); status.hidden = false; status.textContent = '狗狗正在過來…';
    try {
        const { IllustratedPetViewer } = await import('../../features/pets/illustrated-viewer.js?v=care-inventory-20261020-4');
        if (version !== _viewerVersion) return;
        const viewer = new IllustratedPetViewer(document.getElementById('pet-3d-stage'), {
            onEvent: event => {
                if (version !== _viewerVersion) return;
                stage.dataset.carePhase = event.name;
                const words = { feedStart: '啊，開飯了。', chewing: '嚼嚼，好香。', wipeStart: '閉上眼睛，輕輕擦一下。', playStart: '一起玩一下。', petStart: '嗯，再摸一下。' };
                if (words[event.name]) document.getElementById('pet-speech').textContent = words[event.name];
                renderActionButtons();
            },
        });
        _petViewer = viewer; await viewer.load();
        if (version !== _viewerVersion || viewer.disposed) return;
        viewer.setCareItem(_groupPet?.pet_last_toy);
        stage.classList.add('illustrated-ready'); status.hidden = true;
        document.getElementById('btn-pet-touch').hidden = false; renderActionButtons();
    } catch (error) {
        if (version !== _viewerVersion) return;
        _petViewer?.dispose(); _petViewer = null;
        status.textContent = '暫時顯示靜態角色，照顧功能仍可使用。'; status.hidden = false; retry.hidden = false;
    }
}
async function touchPet() {
    if (_actionLock || !_groupPet?.pet_face_url || _groupPet.pet_is_caged || _petViewer?.busy) return;
    if (_petViewer?.loaded) {
        const seq = _screenSeq, playing = _petViewer.playAndWait('pet'); renderActionButtons();
        await playing; if (!sameScreen(seq)) return; renderActionButtons();
    } else { applyAvatarState('happy', true); playPetMotion('tap'); }
    // A friendly touch is cosmetic; it must not claim unearned stat rewards.
    document.getElementById('pet-speech').textContent = '有你陪著真好。';
}
function openAdoptDialog() {
    if (!_isCreator || _actionLock || _adoptBusy) return;
    document.getElementById('pet-adopt-name').value = _groupPet?.pet_name || '';
    document.getElementById('pet-adopt-note').textContent = _groupPet?.pet_face_url ? '更換角色會保留等級、聚會紀錄和目前養成數值。' : '不用上傳照片，領養後就能開始照顧牠。';
    document.getElementById('pet-adopt-error').textContent = '';
    document.getElementById('pet-adopt-dialog').showModal();
}
async function adoptPet(event) {
    event.preventDefault(); if (_adoptBusy || !_isCreator || !_groupId) return;
    const seq = _screenSeq, groupId = _groupId;
    const name = document.getElementById('pet-adopt-name').value.trim();
    _adoptBusy = true;
    const confirm = document.getElementById('btn-pet-adopt-confirm'), cancel = document.getElementById('btn-pet-adopt-cancel');
    confirm.disabled = cancel.disabled = true; confirm.textContent = '準備小夥伴…';
    try {
        const { res, data } = await petRequest(`/api/groups/${groupId}/pet/adopt`, { method: 'POST', body: JSON.stringify({ character_id: 'puppy-v1', name }) });
        if (!sameScreen(seq, groupId)) return;
        if (!res.ok) throw new Error(readApiError(data, '領養失敗，請再試一次'));
        _groupPet = { ..._groupPet, ...data.pet };
        document.getElementById('pet-adopt-dialog').close(); renderGroupMode();
        showActionFeedback('小夥伴加入了，大家一起照顧牠吧。');
    } catch (error) { if (sameScreen(seq, groupId)) document.getElementById('pet-adopt-error').textContent = error.message; }
    finally { _adoptBusy = false; confirm.disabled = cancel.disabled = false; confirm.textContent = '一起照顧牠'; }
}

function statusToAnimClass(status) {
    return { NORMAL:'idle', HAPPY:'happy', HUNGRY:'hungry', LONELY:'hungry', DIRTY:'dirty', CRITICAL:'critical' }[status] || 'idle';
}

function setSpeech(status, force = false) {
    const lines = SPEECHES[status] || SPEECHES.NORMAL;
    const el = document.getElementById('pet-speech');
    if (force || !el.textContent) el.textContent = lines[Math.floor(Math.random() * lines.length)];
}

function renderActionButtons() {
    const pending = _pendingCare.get(careKey())?.action;
    const busy = _actionLock || Boolean(_petViewer?.busy);
    for (const action of ['feed', 'wipe', 'play']) {
        const availability = careAvailability(_groupPet, action, { busy, pending });
        const button = document.getElementById(`btn-pet-${action}`);
        button.disabled = availability.disabled;
        button.classList.toggle('is-cooling', Boolean(availability.remaining));
        button.setAttribute('aria-busy', String(_actionLock && (pending === action)));
        document.getElementById(`pet-${action}-state`).textContent = availability.remaining ? formatCooldown(availability.remaining) : availability.label;
    }
    document.getElementById('btn-pet-touch').disabled = busy || Boolean(_groupPet?.pet_is_caged);
    document.getElementById('btn-pet-character').disabled = busy;
    document.getElementById('btn-pet-rename').disabled = busy;
    document.getElementById('btn-pet-delete').disabled = busy;
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
    if (!_viewActive || document.hidden || !_groupId || _actionLock || _pollBusy) return;
    const seq = _screenSeq, groupId = _groupId; _pollBusy = true;
    try {
        const { res, data } = await petRequest(`/api/groups/${groupId}/pet`);
        if (sameScreen(seq, groupId) && !_actionLock && res.ok && data?.pet) {
            _groupPet = { ..._groupPet, ...data.pet }; renderGroupMode();
            document.getElementById('pet-sync-status').textContent = '已同步群組狀態';
        }
    } catch (_) {
        if (sameScreen(seq, groupId)) document.getElementById('pet-sync-status').textContent = '暫時無法同步，顯示上次狀態';
    } finally { _pollBusy = false; }
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
    return minutes > 0
        ? t('{time} 後', { time: `${minutes}:${String(rest).padStart(2, '0')}` })
        : t('{n} 秒後', { n: rest });
}

function formatChanges(changes) {
    const labels = { pet_energy: '飽食', pet_happiness: '快樂', pet_cleanliness: '清潔' };
    return Object.entries(changes)
        .filter(([, value]) => Number(value) !== 0)
        .map(([key, value]) => `${labels[key] ? t(labels[key]) : key} ${Number(value) > 0 ? '+' : ''}${value}`)
        .join(getLang() === 'en' ? ', ' : '、');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }


function syncCareCollection() {
    if (!_groupPet) return;
    const key = careKey();
    if (!_pendingDraw.has(key)) {
        try {
            const saved = JSON.parse(sessionStorage.getItem(`pet_draw_pending:${key}`));
            if (saved && ['food','toy'].includes(saved.kind) && /^[A-Za-z0-9_-]{8,64}$/.test(saved.request_id)) _pendingDraw.set(key,saved);
        } catch { /* Storage may be unavailable; in-memory retries still work. */ }
    }
    document.getElementById('pet-coin-balance').textContent = Number(_groupPet.pet_coins || 0);
    document.getElementById('btn-pet-draw').disabled = !_careCatalog;
    document.getElementById('btn-pet-bag').disabled = !_careCatalog;
    _careCollection?.update({pet:_groupPet,catalog:_careCatalog,pending:_pendingDraw.get(careKey()),busy:_drawBusy});
}
async function drawCareItem(kind) {
    if (_drawBusy || !_groupId) return;
    const key = careKey(), seq = _screenSeq, groupId = _groupId;
    const pending = _pendingDraw.get(key);
    if (pending && pending.kind !== kind) return;
    const request = pending || {kind,request_id:crypto.randomUUID()};
    _pendingDraw.set(key,request);
    try { sessionStorage.setItem(`pet_draw_pending:${key}`,JSON.stringify(request)); } catch { /* Keep in-memory request. */ }
    _drawBusy = true;
    const status = document.getElementById('pet-draw-status'); status.textContent = t('正在打開小包…');
    syncCareCollection();
    try {
        const {res,data} = await petRequest(`/api/groups/${encodeURIComponent(groupId)}/pet/draw`, {method:'POST',body:JSON.stringify(request)});
        if (!res.ok) {
            if (res.status < 500) clearPendingDraw(key);
            throw new Error(readApiError(data,'抽取失敗，請再試一次'));
        }
        clearPendingDraw(key);
        if (!sameScreen(seq,groupId)) return;
        for (const field of ['pet_coins','pet_food_inventory','pet_owned_toys','pet_discovered_items']) {
            if (data[field] !== undefined) _groupPet[field] = data[field];
        }
        const message = data.duplicate ? t('已收藏的玩具，返還 {n} 金幣', {n:data.refund})
            : data.care_item.kind === 'food' ? t('已放進群組背包，共 {n} 份', {n:data.quantity}) : t('已放進群組背包，可重複使用');
        _careCollection.result(data.care_item,message);
        status.textContent = t(data.replayed ? '已確認上次的抽取結果，沒有再次扣款。' : '打開背包就能使用。');
    } catch(error) {
        if (sameScreen(seq,groupId)) status.textContent = _pendingDraw.has(key) ? t('尚未確認結果，請按原抽取按鈕重試，不會再次扣款。') : error.message;
    } finally {
        _drawBusy = false;
        if (sameScreen(seq,groupId)) syncCareCollection();
    }
}

function clearPendingDraw(key) {
    _pendingDraw.delete(key);
    try { sessionStorage.removeItem(`pet_draw_pending:${key}`); } catch { /* Optional persistence. */ }
}
