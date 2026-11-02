// features/photos/controller.js — 聚會照片上傳/壓縮/列表
import { state } from '../../core/state.js';
import { apiFetch, apiBase, setProtectedImage, fetchProtectedBlob } from '../../core/api.js';
import { switchView } from '../../core/router.js';
import { t } from '../../core/i18n.js';
import { showToast } from '../../utils/toast.js';

// === photoMode 旗標 — 拍照時暫停分心偵測 ===
export function startPhotoMode() {
    state.photoModeActive = true;
    if (state.photoModeTimeoutObj) clearTimeout(state.photoModeTimeoutObj);
    // 30 秒保險:萬一 file picker 取消沒觸發 change,避免 flag 卡住
    state.photoModeTimeoutObj = setTimeout(() => {
        console.warn('[photoMode] 30s timeout reached, force end');
        endPhotoMode();
    }, 30000);
}

export function endPhotoMode() {
    state.photoModeActive = false;
    if (state.photoModeTimeoutObj) {
        clearTimeout(state.photoModeTimeoutObj);
        state.photoModeTimeoutObj = null;
    }
}

// === 存到手機「照片」App ===
// 只有原生 App 有（LockState.savePhoto，只要「加入照片」權限）；網頁版不顯示相關選項。
// 用 App 相機拍的照片預設自動存一份（「更多」頁可以關）；聚會相簿的大圖可以手動存。
const AUTO_SAVE_KEY = 'phubbing_save_photos';
const DENIED_HINT_KEY = 'phubbing_photo_denied_hint';

function photoPlugin() {
    const p = window.Capacitor?.Plugins?.LockState;
    return p && typeof p.savePhoto === 'function' ? p : null;
}

export function canSaveToDevice() {
    return !!photoPlugin();
}

export function autoSavePhotos() {
    try { return localStorage.getItem(AUTO_SAVE_KEY) !== '0'; } catch (_) { return true; }
}

export function setAutoSavePhotos(on) {
    try { localStorage.setItem(AUTO_SAVE_KEY, on ? '1' : '0'); } catch (_) { /* 存不了就只在這次有效 */ }
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(blob);
    });
}

const DENIED_TEXT = '沒有相簿權限，照片沒有存到手機。可以到「設定」→「社交定錨」→「照片」打開。';

// 存一張照片到手機。回傳 'saved' | 'denied' | 'failed' | 'unavailable'。
export async function savePhotoToDevice(blob) {
    const p = photoPlugin();
    if (!p || !blob) return 'unavailable';
    try {
        const res = await p.savePhoto({ data: await blobToBase64(blob) });
        if (res?.saved) return 'saved';
        return res?.reason === 'denied' ? 'denied' : 'failed';
    } catch (_) {
        return 'failed';
    }
}

// 拍照後自動存：拒絕權限只提示一次，之後安靜略過（不要每拍一張就吵一次）。
export async function autoSaveCapturedPhoto(file) {
    if (!canSaveToDevice() || !autoSavePhotos()) return 'unavailable';
    const result = await savePhotoToDevice(file);
    if (result === 'denied') {
        let shown = false;
        try { shown = localStorage.getItem(DENIED_HINT_KEY) === '1'; localStorage.setItem(DENIED_HINT_KEY, '1'); } catch (_) {}
        if (!shown) showToast(t(DENIED_TEXT), 'info');
    }
    return result;
}

// === 圖片壓縮 — canvas resize 到長邊 1920 + JPEG 0.8 ===
async function compressImage(file, maxEdge = 1920, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            let { width, height } = img;
            if (width > maxEdge || height > maxEdge) {
                if (width >= height) {
                    height = Math.round(height * maxEdge / width);
                    width = maxEdge;
                } else {
                    width = Math.round(width * maxEdge / height);
                    height = maxEdge;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => {
                if (!blob) return reject(new Error('壓縮失敗'));
                resolve(blob);
            }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('無法讀取圖片')); };
        img.src = URL.createObjectURL(file);
    });
}

export async function uploadMeetingPhoto(meetingId, file) {
    let uploadBlob;
    try {
        uploadBlob = await compressImage(file);
    } catch (e) {
        console.warn('compress failed, fall back to original:', e);
        uploadBlob = file;
    }
    const headers = {};
    if (state.currentUser) {
        const idToken = await state.currentUser.getIdToken(false);
        headers.Authorization = 'Bearer ' + idToken;
    } else if (state.userId) {
        headers['X-Guest-Uid'] = state.userId;
    } else {
        throw new Error('請先加入聚會');
    }
    const form = new FormData();
    form.append('file', uploadBlob, 'photo.jpg');

    const res = await fetch(`${apiBase}/api/meetings/${meetingId}/photos`, {
        method: 'POST',
        headers,
        body: form
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') {
        throw new Error(data.detail || '上傳失敗');
    }
    return data.photo;
}

// === 載入聚會照片列表 (給 meeting-detail 用) ===
export async function loadMeetingPhotos(meetingId) {
    const grid = document.getElementById('md-photos-grid');
    const empty = document.getElementById('md-photos-empty');
    const countEl = document.getElementById('md-photo-count');
    if (grid) grid.innerHTML = '<p class="hint">讀取中...</p>';
    if (empty) empty.style.display = 'none';

    try {
        const { res, data } = await apiFetch(`/api/meetings/${meetingId}/photos`);
        if (data.status !== 'success') throw new Error(data.detail || '讀取照片失敗');
        state.currentMeetingPhotos = data.photos || [];
        renderMeetingPhotosGrid();
        if (countEl) countEl.innerText = state.currentMeetingPhotos.length;
    } catch (err) {
        console.error('loadMeetingPhotos failed:', err);
        if (grid) grid.innerHTML = `<p class="hint" style="color:#fca5a5;">${t('讀取失敗:')}${err.message || err}</p>`;
    }
}

export function renderMeetingPhotosGrid() {
    const grid = document.getElementById('md-photos-grid');
    const empty = document.getElementById('md-photos-empty');
    const countEl = document.getElementById('md-photo-count');
    if (!grid) return;
    grid.innerHTML = '';
    if (countEl) countEl.innerText = state.currentMeetingPhotos.length;

    if (!state.currentMeetingPhotos.length) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    state.currentMeetingPhotos.forEach(p => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile' + (p.is_cover ? ' is-cover' : '');
        setProtectedImage(tile, p.content_path, { background: true }).catch(err => {
            console.warn('load protected meeting photo failed:', err);
            tile.classList.add('photo-load-failed');
        });
        if (p.is_cover) {
            const badge = document.createElement('span');
            badge.className = 'photo-cover-badge';
            badge.innerText = '封面';
            tile.appendChild(badge);
        }
        tile.onclick = () => openPhotoLightbox(p);
        grid.appendChild(tile);
    });
}

// === Lightbox (放大檢視) ===
export function openPhotoLightbox(photo) {
    state.lightboxPhoto = photo;
    const lightbox = document.getElementById('lightbox-img');
    lightbox.removeAttribute('src');
    setProtectedImage(lightbox, photo.content_path).catch(err => {
        console.warn('load protected lightbox photo failed:', err);
    });
    const canManage = state.currentMeetingIsHost;
    const saveBtn = document.getElementById('btn-lightbox-save');
    if (saveBtn) saveBtn.style.display = canSaveToDevice() ? 'inline-block' : 'none';
    document.getElementById('btn-lightbox-set-cover').style.display = (canManage && !photo.is_cover) ? 'inline-block' : 'none';
    document.getElementById('btn-lightbox-delete').style.display = canManage ? 'inline-block' : 'none';
    switchView('view-photo-lightbox');
}

export function closePhotoLightbox() {
    state.lightboxPhoto = null;
    switchView('view-meeting-detail');
}

export async function lightboxSaveToDevice() {
    const photo = state.lightboxPhoto;
    const btn = document.getElementById('btn-lightbox-save');
    if (!photo || !btn || btn.disabled) return;
    btn.disabled = true;
    let result = 'failed';
    try {
        result = await savePhotoToDevice(await fetchProtectedBlob(photo.content_path));
    } catch (err) {
        console.warn('save lightbox photo failed:', err);
    } finally {
        btn.disabled = false;
    }
    if (result === 'saved') showToast(t('已存到手機'), 'success');
    else if (result === 'denied') showToast(t(DENIED_TEXT), 'info');
    else showToast(t('存到手機失敗，請再試一次'), 'error');
}

export async function lightboxSetCover() {
    if (!state.lightboxPhoto || !state.currentMeetingDetailId) return;
    try {
        const { res, data } = await apiFetch(
            `/api/meetings/${state.currentMeetingDetailId}/photos/${state.lightboxPhoto.id}/cover`,
            { method: 'PATCH' }
        );
        if (!res.ok || data.status !== 'success') throw new Error(data.detail || '設定失敗');
        closePhotoLightbox();
        await loadMeetingPhotos(state.currentMeetingDetailId);
    } catch (err) {
        alert(t('設定封面失敗:') + (err.message || err));
    }
}

export async function lightboxDelete() {
    if (!state.lightboxPhoto || !state.currentMeetingDetailId) return;
    if (!confirm(t('確定刪除這張照片?'))) return;
    try {
        const { res, data } = await apiFetch(
            `/api/meetings/${state.currentMeetingDetailId}/photos/${state.lightboxPhoto.id}`,
            { method: 'DELETE' }
        );
        if (!res.ok || data.status !== 'success') throw new Error(data.detail || '刪除失敗');
        closePhotoLightbox();
        await loadMeetingPhotos(state.currentMeetingDetailId);
    } catch (err) {
        alert(t('刪除照片失敗:') + (err.message || err));
    }
}
