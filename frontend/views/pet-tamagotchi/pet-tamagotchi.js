import { register, switchView } from '../../core/router.js';
import { apiFetch } from '../../core/api.js';
import { state } from '../../core/state.js';

const SPEECHES = {
    NORMAL:   ['汪汪！你好！', '今天天氣很好～', '陪我玩嘛～', '我在這裡！'],
    HAPPY:    ['好開心！好開心！🎉', '你真是個好主人！', '耶！耶！耶！', '汪汪！愛你！'],
    SLEEPING: ['zzz...', '呼呼...', '嗯嗯...'],
    HUNGRY:   ['肚子好餓... 🥺', '可以給我吃點東西嗎？', '嗚嗚... 好餓...'],
    DIRTY:    ['我身上有臭臭... 😭', '快幫我擦一擦！', '好臭好臭！'],
    CRITICAL: ['嗚嗚... 快撐不住了...', '求求你快救我... 💔', '好難受...'],
};

let _pet       = null;
let _groupPet  = null;
let _groupId   = null;
let _pollTimer = null;
let _actionLock = false;

function isGroupMode() { return !!_groupId; }
function isPersonalSleeping() { return !isGroupMode() && !!_pet?.my_pet_is_sleeping; }

export function init() {
    register('view-pet-tamagotchi', {
        element: document.getElementById('view-pet-tamagotchi'),
        onShow,
        onHide,
    });

    document.getElementById('btn-go-pet-swap').onclick         = () => switchView('view-pet-swap');
    document.getElementById('btn-pet-tama-back-nopet').onclick = () => switchView('view-home');
    document.getElementById('btn-pet-tama-back').onclick       = () => switchView('view-home');

    document.getElementById('btn-pet-feed').onclick  = () => doAction('feed');
    document.getElementById('btn-pet-wipe').onclick  = () => doAction('wipe');
    document.getElementById('btn-pet-play').onclick  = () => doAction('play');
    document.getElementById('btn-pet-sleep').onclick = () => doAction(isPersonalSleeping() ? 'wake' : 'sleep');

    document.getElementById('btn-pet-rename').onclick    = openRenameDialog;
    document.getElementById('btn-rename-confirm').onclick = confirmRename;
    document.getElementById('btn-rename-cancel').onclick  = closeRenameDialog;

    document.getElementById('btn-pet-delete').onclick     = openDeleteDialog;
    document.getElementById('btn-delete-confirm').onclick  = confirmDelete;
    document.getElementById('btn-delete-cancel').onclick   = closeDeleteDialog;
    document.getElementById('pet-rename-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmRename();
        if (e.key === 'Escape') closeRenameDialog();
    });
}

async function onShow() {
    _groupId  = state.tamagotchiGroupId || null;
    _pet      = null;
    _groupPet = null;
    showLoading(true);
    await loadPet();
    startPolling();
}

function onHide() { stopPolling(); }

async function loadPet() {
    try {
        if (isGroupMode()) {
            const [petRes, grpRes] = await Promise.all([
                apiFetch(`/api/groups/${_groupId}/pet`),
                apiFetch(`/api/groups/${_groupId}`),
            ]);
            _groupPet = petRes.data?.pet || null;
            if (_groupPet) {
                _groupPet._groupName = grpRes.data?.group?.name || '群組';
            }
        } else {
            const { data } = await apiFetch('/api/my-pet');
            _pet = data?.pet || null;
        }
    } catch (e) {
        console.error('load pet error', e);
    }
    renderAll();
    showLoading(false);
}

async function doAction(action) {
    if (_actionLock) return;
    const hasContent = isGroupMode() ? !!_groupPet?.pet_face_url : !!_pet;
    if (!hasContent) return;
    _actionLock = true;
    setAllButtonsDisabled(true);

    const animMap = { feed: 'eating', wipe: 'wiping', play: 'playing' };
    const tempAnim = animMap[action];
    if (tempAnim) applyAvatarState(tempAnim);

    try {
        if (isGroupMode()) {
            const { data } = await apiFetch(`/api/groups/${_groupId}/pet/action`, {
                method: 'POST',
                body: JSON.stringify({ action }),
            });
            if (data?.pet_energy !== undefined && _groupPet) {
                _groupPet.pet_energy = data.pet_energy;
                _groupPet.pet_status = data.pet_status;
            }
        } else {
            const { data } = await apiFetch('/api/my-pet/action', {
                method: 'POST',
                body: JSON.stringify({ action }),
            });
            if (data?.pet) _pet = data.pet;
        }
    } catch (e) {
        console.error('pet action error', e);
    }

    await delay(tempAnim ? 800 : 0);
    renderAll();
    setAllButtonsDisabled(false);
    _actionLock = false;
}

function renderAll() {
    if (isGroupMode()) renderGroupMode();
    else renderPersonalMode();
}

function renderGroupMode() {
    if (!_groupPet?.pet_face_url) {
        document.getElementById('pet-no-pet-title').textContent  = '群組還沒有設定寵物臉';
        document.getElementById('pet-no-pet-desc').textContent   = '請先在群組設定頁生成並設定寵物臉！';
        document.getElementById('btn-go-pet-swap').style.display = 'none';
        showScreen('no-pet');
        return;
    }
    showScreen('game');

    document.getElementById('pet-group-badge').style.display = 'inline-flex';
    document.getElementById('pet-group-name').textContent    = _groupPet._groupName || '群組';
    document.getElementById('pet-tama-name').textContent     = _groupPet.pet_name || '群組寵物';
    document.getElementById('btn-pet-rename').style.display  = 'none';
    document.getElementById('btn-pet-delete').style.display  = 'none';

    const img = document.getElementById('pet-avatar-img');
    if (img.src !== _groupPet.pet_face_url) img.src = _groupPet.pet_face_url;

    document.getElementById('pet-personal-stats').style.display = 'none';
    document.getElementById('pet-group-stats').style.display    = 'block';

    const energy = _groupPet.pet_energy ?? 50;
    const maxE   = _groupPet.pet_max_energy ?? 100;
    const hp     = _groupPet.pet_hp ?? 5;
    document.getElementById('fill-group-energy').style.width = Math.round(energy / maxE * 100) + '%';
    document.getElementById('val-group-energy').textContent  = energy;

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
    document.getElementById('pet-zzz').style.display   = 'none';
    document.getElementById('btn-pet-sleep').style.display = 'none';

    const status = _groupPet.pet_status || 'NORMAL';
    applyAvatarState(statusToAnimClass(status));
    setSpeech(status);
}

function renderPersonalMode() {
    document.getElementById('btn-go-pet-swap').style.display   = '';
    document.getElementById('pet-no-pet-title').textContent    = '還沒有寵物';
    document.getElementById('pet-no-pet-desc').textContent     = '先去生成一張寵物臉，再回來養它！';

    if (!_pet) { showScreen('no-pet'); return; }
    showScreen('game');

    document.getElementById('pet-group-badge').style.display   = 'none';
    document.getElementById('pet-tama-name').textContent       = _pet.my_pet_name || '我的寵物';
    document.getElementById('btn-pet-rename').style.display    = '';
    document.getElementById('btn-pet-delete').style.display    = '';

    const img = document.getElementById('pet-avatar-img');
    if (img.src !== _pet.my_pet_image_url) img.src = _pet.my_pet_image_url;

    document.getElementById('pet-personal-stats').style.display = 'block';
    document.getElementById('pet-group-stats').style.display    = 'none';

    setBar('hunger',    _pet.my_pet_hunger);
    setBar('happiness', _pet.my_pet_happiness);
    setBar('energy',    _pet.my_pet_energy);
    setBar('clean',     _pet.my_pet_cleanliness);

    toggleIcon('pet-poop-icon', _pet.my_pet_has_poop);
    toggleIcon('pet-pee-icon',  _pet.my_pet_has_pee);

    const sleeping = _pet.my_pet_is_sleeping;
    document.getElementById('pet-zzz').style.display      = sleeping ? 'flex' : 'none';
    const btnSleep = document.getElementById('btn-pet-sleep');
    btnSleep.style.display = '';
    if (sleeping) {
        btnSleep.querySelector('.action-icon').textContent    = '☀️';
        btnSleep.querySelector('span:last-child').textContent = '叫醒';
        btnSleep.classList.add('active-toggle');
    } else {
        btnSleep.querySelector('.action-icon').textContent    = '😴';
        btnSleep.querySelector('span:last-child').textContent = '睡覺';
        btnSleep.classList.remove('active-toggle');
    }

    const status = _pet.my_pet_status || 'NORMAL';
    applyAvatarState(statusToAnimClass(status));
    setSpeech(status);
}

function showScreen(which) {
    document.getElementById('pet-tama-loading').style.display = 'none';
    document.getElementById('pet-no-pet').style.display       = which === 'no-pet' ? 'block' : 'none';
    document.getElementById('pet-game-wrap').style.display    = which === 'game'   ? 'flex'  : 'none';
}

function setBar(key, value) {
    const v = Math.max(0, Math.min(100, value ?? 0));
    document.getElementById(`fill-${key}`).style.width = v + '%';
    document.getElementById(`val-${key}`).textContent  = v;
}

function toggleIcon(id, show) {
    const el = document.getElementById(id);
    if (show) el.classList.add('show');
    else       el.classList.remove('show');
}

function applyAvatarState(cls) {
    document.getElementById('pet-avatar-wrap').className = `pet-avatar-wrap state-${cls}`;
}

function statusToAnimClass(status) {
    return { NORMAL: 'idle', HAPPY: 'happy', SLEEPING: 'sleeping', HUNGRY: 'hungry', DIRTY: 'dirty', CRITICAL: 'critical' }[status] || 'idle';
}

function setSpeech(status) {
    const lines = SPEECHES[status] || SPEECHES.NORMAL;
    document.getElementById('pet-speech').textContent = lines[Math.floor(Math.random() * lines.length)];
}

function showLoading(show) {
    document.getElementById('pet-tama-loading').style.display = show ? 'block' : 'none';
    if (show) {
        document.getElementById('pet-no-pet').style.display    = 'none';
        document.getElementById('pet-game-wrap').style.display = 'none';
    }
}

function setAllButtonsDisabled(disabled) {
    ['btn-pet-feed','btn-pet-wipe','btn-pet-play','btn-pet-sleep'].forEach(id => {
        document.getElementById(id).disabled = disabled;
    });
}

function openRenameDialog() {
    if (isGroupMode()) return;
    document.getElementById('pet-rename-input').value = _pet?.my_pet_name || '';
    document.getElementById('pet-rename-overlay').style.display = 'flex';
    document.getElementById('pet-rename-input').focus();
}
function closeRenameDialog() {
    document.getElementById('pet-rename-overlay').style.display = 'none';
}
async function confirmRename() {
    if (!_pet || isGroupMode()) return;
    const name = document.getElementById('pet-rename-input').value.trim().slice(0, 20);
    closeRenameDialog();
    if (!name) return;
    try {
        // 用 PATCH 只改名字，不會像 setup 那樣把養成數值重置
        await apiFetch('/api/my-pet', {
            method: 'PATCH',
            body: JSON.stringify({ name }),
        });
        _pet.my_pet_name = name;
        document.getElementById('pet-tama-name').textContent = name;
    } catch (e) { console.error('rename error', e); }
}

function openDeleteDialog() {
    if (isGroupMode()) return;
    document.getElementById('pet-delete-overlay').style.display = 'flex';
}
function closeDeleteDialog() {
    document.getElementById('pet-delete-overlay').style.display = 'none';
}
async function confirmDelete() {
    if (!_pet || isGroupMode()) return;
    closeDeleteDialog();
    try {
        await apiFetch('/api/my-pet', { method: 'DELETE' });
        stopPolling();
        _pet = null;
        switchView('view-home');
    } catch (e) { console.error('delete error', e); }
}

function startPolling() {
    _pollTimer = setInterval(async () => {
        if (_actionLock) return;
        try {
            if (isGroupMode()) {
                const { data } = await apiFetch(`/api/groups/${_groupId}/pet`);
                if (data?.pet) { _groupPet = { ..._groupPet, ...data.pet }; renderAll(); }
            } else {
                const { data } = await apiFetch('/api/my-pet');
                if (data?.pet) { _pet = data.pet; renderAll(); }
            }
        } catch (_) {}
    }, 60_000);
}
function stopPolling() { clearInterval(_pollTimer); _pollTimer = null; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
