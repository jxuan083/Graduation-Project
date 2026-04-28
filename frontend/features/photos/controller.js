// features/photos/controller.js — 聚會照片上傳/壓縮/列表
import { state } from '../../core/state.js';
import { apiFetch, apiBase } from '../../core/api.js';
import { switchView } from '../../core/router.js';

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
    if (!state.currentUser) throw new Error('請先登入');
    const idToken = await state.currentUser.getIdToken(false);
    const form = new FormData();
    form.append('file', uploadBlob, 'photo.jpg');

    const res = await fetch(`${apiBase}/api/meetings/${meetingId}/photos`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken },
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
        if (grid) grid.innerHTML = `<p class="hint" style="color:#fca5a5;">讀取失敗:${err.message || err}</p>`;
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
        tile.style.backgroundImage = `url("${p.url}")`;
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
    document.getElementById('lightbox-img').src = photo.url;
    const canManage = state.currentMeetingIsHost;
    document.getElementById('btn-lightbox-set-cover').style.display = (canManage && !photo.is_cover) ? 'inline-block' : 'none';
    document.getElementById('btn-lightbox-delete').style.display = canManage ? 'inline-block' : 'none';
    switchView('view-photo-lightbox');
}

export function closePhotoLightbox() {
    state.lightboxPhoto = null;
    switchView('view-meeting-detail');
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
        alert('設定封面失敗:' + (err.message || err));
    }
}

export async function lightboxDelete() {
    if (!state.lightboxPhoto || !state.currentMeetingDetailId) return;
    if (!confirm('確定刪除這張照片?')) return;
    try {
        const { res, data } = await apiFetch(
            `/api/meetings/${state.currentMeetingDetailId}/photos/${state.lightboxPhoto.id}`,
            { method: 'DELETE' }
        );
        if (!res.ok || data.status !== 'success') throw new Error(data.detail || '刪除失敗');
        closePhotoLightbox();
        await loadMeetingPhotos(state.currentMeetingDetailId);
    } catch (err) {
        alert('刪除照片失敗:' + (err.message || err));
    }
}
