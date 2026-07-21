// views/profile/profile.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { storage } from '../../core/firebase.js';
import { apiFetch } from '../../core/api.js';
import { goHomeFromMenu } from '../../core/session.js';
import { events } from '../../core/events.js';
import { t } from '../../core/i18n.js';

// Tinder 風格預設興趣（key 為繁中，顯示時經 t() 翻譯）
const PRESET_INTERESTS = [
    '咖啡', '美食', '烹飪', '健身', '爬山', '露營', '跑步', '游泳',
    '籃球', '羽球', '桌遊', '電玩', '追劇', '電影', '音樂', '唱歌',
    '攝影', '旅行', '閱讀', '寵物', '畫畫', '動漫', 'K-pop', '手作',
];
const MAX_INTERESTS = 5;

// 已選標籤一律從 DOM 讀（唯一真相來源）。
// 不放模組變數:profile.js 曾同時以「有/無 ?v=」兩種 URL 被 import,
// 產生兩個模組實例,狀態放變數會分裂(選了標籤卻存出空陣列)。
function getSelectedInterests() {
    return Array.from(document.querySelectorAll('#profile-interests-selected .interest-chip'))
        .map(btn => btn.dataset.tag)
        .filter(Boolean)
        .slice(0, MAX_INTERESTS);
}

export function init() {
    register('view-profile', { element: document.getElementById('view-profile') });
    document.getElementById('btn-profile-save').onclick = saveProfile;
    document.getElementById('btn-profile-back').onclick = goHomeFromMenu;
    document.getElementById('btn-interest-add').onclick = addCustomInterest;
    document.getElementById('profile-interest-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addCustomInterest(); }
    });

    // 即時預覽頭像
    document.getElementById('profile-avatar-input').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) {
            const url = URL.createObjectURL(f);
            document.getElementById('profile-avatar-preview').src = url;
        }
    });
}

function toggleInterest(tag) {
    const cur = getSelectedInterests();
    if (cur.includes(tag)) {
        renderInterests(cur.filter(x => x !== tag));
        return;
    }
    if (cur.length >= MAX_INTERESTS) {
        const statusEl = document.getElementById('profile-status');
        statusEl.style.color = '#f87171';
        statusEl.innerText = t('最多只能選 {count} 個標籤', { count: MAX_INTERESTS });
        return;
    }
    renderInterests(cur.concat(tag));
}

function addCustomInterest() {
    const input = document.getElementById('profile-interest-input');
    const tag = (input.value || '').trim().slice(0, 12);
    if (!tag) return;
    input.value = '';
    if (!getSelectedInterests().includes(tag)) toggleInterest(tag);
}

function renderInterests(selected) {
    const selEl = document.getElementById('profile-interests-selected');
    const preEl = document.getElementById('profile-interests-presets');
    const full = selected.length >= MAX_INTERESTS;

    selEl.innerHTML = selected.map(tag =>
        `<button type="button" class="interest-chip on" data-tag="${escAttr(tag)}">${escHtml(t(tag))}<span class="chip-x">×</span></button>`
    ).join('');
    preEl.innerHTML = PRESET_INTERESTS.filter(tag => !selected.includes(tag)).map(tag =>
        `<button type="button" class="interest-chip${full ? ' disabled' : ''}" data-tag="${escAttr(tag)}">${escHtml(t(tag))}</button>`
    ).join('');

    [selEl, preEl].forEach(el => el.querySelectorAll('.interest-chip').forEach(btn => {
        btn.onclick = () => toggleInterest(btn.dataset.tag);
    }));
}

export function openProfileView() {
    if (!state.currentUser) {
        alert(t('請先登入 Google 帳號'));
        return;
    }
    document.getElementById('profile-avatar-preview').src =
        (state.currentProfile && state.currentProfile.photoURL) || state.currentUser.photoURL || '';
    document.getElementById('profile-nickname').value =
        (state.currentProfile && state.currentProfile.nickname) || state.currentUser.displayName || '';
    document.getElementById('profile-bio').value =
        (state.currentProfile && state.currentProfile.bio) || '';
    document.getElementById('profile-handle').value =
        (state.currentProfile && state.currentProfile.handle) || '';
    renderInterests(Array.isArray(state.currentProfile?.interests)
        ? state.currentProfile.interests.slice(0, MAX_INTERESTS) : []);
    document.getElementById('profile-status').innerText = '';
    switchView('view-profile');
}

async function uploadAvatar(file) {
    if (!state.currentUser) throw new Error('未登入');
    const ref = storage.ref().child(`avatars/${state.currentUser.uid}/${Date.now()}_${file.name}`);
    const snap = await ref.put(file);
    return await snap.ref.getDownloadURL();
}

async function saveProfile() {
    if (!state.currentUser) return;
    const statusEl = document.getElementById('profile-status');
    statusEl.style.color = '#34d399';
    statusEl.innerText = '儲存中...';

    const payload = {
        nickname: document.getElementById('profile-nickname').value.trim(),
        bio: document.getElementById('profile-bio').value.trim(),
        handle: document.getElementById('profile-handle').value.trim().toLowerCase(),
        interests: getSelectedInterests()
    };
    const fileInput = document.getElementById('profile-avatar-input');
    const file = fileInput.files && fileInput.files[0];
    try {
        if (file) {
            statusEl.innerText = '上傳頭像中...';
            payload.photoURL = await uploadAvatar(file);
        }
        const { res, data } = await apiFetch('/api/profile', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (data && data.status === 'success') {
            state.currentProfile = data.profile;
            events.emit('profile:updated', data.profile);
            statusEl.innerText = '已儲存 ✔';
            fileInput.value = '';
        } else {
            statusEl.style.color = '#f87171';
            statusEl.innerText = t('儲存失敗:') + ((data && data.detail) || JSON.stringify(data));
        }
    } catch (err) {
        statusEl.style.color = '#f87171';
        statusEl.innerText = t('儲存失敗:') + (err.message || err);
    }
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }
