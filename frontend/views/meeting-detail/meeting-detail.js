// views/meeting-detail/meeting-detail.js — 單場聚會詳情頁
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import {
    openMeetingsList,
    saveMeetingTranscriptFromInput,
    transcribeMeetingAudio,
    generateMeetingNewspaper,
} from '../../features/meetings/controller.js';
import { startPhotoMode, endPhotoMode, uploadMeetingPhoto, loadMeetingPhotos } from '../../features/photos/controller.js';
import { t } from '../../core/i18n.js';

export function init() {
    register('view-meeting-detail', { element: document.getElementById('view-meeting-detail') });
    document.getElementById('btn-meeting-detail-back').onclick = openMeetingsList;
    document.getElementById('btn-md-camera-photo').onclick = () => handleDetailPhotoClick('md-camera-input');
    document.getElementById('btn-md-album-photo').onclick = () => handleDetailPhotoClick('md-album-input');
    document.getElementById('btn-md-save-transcript').onclick = saveMeetingTranscriptFromInput;
    document.getElementById('btn-md-transcribe-audio').onclick = transcribeMeetingAudio;
    document.getElementById('btn-md-generate-newspaper').onclick = generateMeetingNewspaper;
    document.getElementById('md-camera-input').addEventListener('change', handleDetailPhotoChange);
    document.getElementById('md-album-input').addEventListener('change', handleDetailPhotoChange);
}

function handleDetailPhotoClick(inputId) {
    if (!state.currentMeetingDetailId) return;
    if (state.currentMeetingPhotos.length >= 10) {
        alert(t('每場聚會最多 10 張照片'));
        return;
    }
    startPhotoMode();
    const input = document.getElementById(inputId);
    input.value = '';
    input.click();
}

async function handleDetailPhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    endPhotoMode();
    if (!file || !state.currentMeetingDetailId) return;
    const btn = e.target.id === 'md-camera-input'
        ? document.getElementById('btn-md-camera-photo')
        : document.getElementById('btn-md-album-photo');
    const orig = btn.innerText;
    btn.disabled = true;
    btn.innerText = '上傳中...';
    try {
        await uploadMeetingPhoto(state.currentMeetingDetailId, file);
        await loadMeetingPhotos(state.currentMeetingDetailId);
    } catch (err) {
        alert(t('照片上傳失敗:') + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerText = orig;
    }
}
