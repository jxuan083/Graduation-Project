// views/meeting-detail/meeting-detail.js — 單場聚會詳情頁
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import { openMeetingsList } from '../../features/meetings/controller.js';
import { uploadMeetingPhoto, loadMeetingPhotos } from '../../features/photos/controller.js';

export function init() {
    register('view-meeting-detail', { element: document.getElementById('view-meeting-detail') });
    document.getElementById('btn-meeting-detail-back').onclick = openMeetingsList;
    document.getElementById('btn-md-add-photo').onclick = handleDetailPhotoClick;
    document.getElementById('md-photo-input').addEventListener('change', handleDetailPhotoChange);
}

function handleDetailPhotoClick() {
    if (!state.currentMeetingIsHost || !state.currentMeetingDetailId) return;
    if (state.currentMeetingPhotos.length >= 10) {
        alert('每場聚會最多 10 張照片');
        return;
    }
    const input = document.getElementById('md-photo-input');
    input.value = '';
    input.click();
}

async function handleDetailPhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !state.currentMeetingDetailId) return;
    const btn = document.getElementById('btn-md-add-photo');
    const orig = btn.innerText;
    btn.disabled = true;
    btn.innerText = '⏳ 上傳中...';
    try {
        await uploadMeetingPhoto(state.currentMeetingDetailId, file);
        await loadMeetingPhotos(state.currentMeetingDetailId);
    } catch (err) {
        alert('照片上傳失敗:' + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerText = orig;
    }
}
