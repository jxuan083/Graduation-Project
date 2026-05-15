// views/profile/profile.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { storage } from '../../core/firebase.js';
import { apiFetch } from '../../core/api.js';
import { goHomeFromMenu } from '../../core/session.js';
import { events } from '../../core/events.js';

export function init() {
    register('view-profile', { element: document.getElementById('view-profile') });
    document.getElementById('btn-profile-save').onclick = saveProfile;
    document.getElementById('btn-profile-back').onclick = goHomeFromMenu;

    // 即時預覽頭像
    document.getElementById('profile-avatar-input').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) {
            const url = URL.createObjectURL(f);
            document.getElementById('profile-avatar-preview').src = url;
        }
    });
}

export function openProfileView() {
    if (!state.currentUser) {
        alert('請先登入 Google 帳號');
        return;
    }
    document.getElementById('profile-avatar-preview').src =
        (state.currentProfile && state.currentProfile.photoURL) || state.currentUser.photoURL || '';
    document.getElementById('profile-nickname').value =
        (state.currentProfile && state.currentProfile.nickname) || state.currentUser.displayName || '';
    document.getElementById('profile-bio').value =
        (state.currentProfile && state.currentProfile.bio) || '';
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
        bio: document.getElementById('profile-bio').value.trim()
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
            statusEl.innerText = '儲存失敗:' + ((data && data.detail) || JSON.stringify(data));
        }
    } catch (err) {
        statusEl.style.color = '#f87171';
        statusEl.innerText = '儲存失敗:' + (err.message || err);
    }
}
