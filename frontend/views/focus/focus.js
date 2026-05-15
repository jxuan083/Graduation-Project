// views/focus/focus.js
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { openQaSourcePicker } from '../qa-source/qa-source.js';
import { hostStartTabooGame } from '../../features/taboo/controller.js';
import { startPhotoMode, endPhotoMode, uploadMeetingPhoto } from '../../features/photos/controller.js';
import { openInviteModal } from '../invite-modal/invite-modal.js';

export function init() {
    register('view-focus', { element: document.getElementById('view-focus') });

    // 折疊成員清單
    const btnFocusToggle = document.getElementById('btn-focus-members-toggle');
    if (btnFocusToggle) btnFocusToggle.onclick = toggleFocusMembersPanel;

    // 房主發起問答
    const qaBtn = document.getElementById('btn-mode-qa');
    if (qaBtn) qaBtn.addEventListener('click', openQaSourcePicker);

    // 房主發起關鍵字遊戲
    const tabooBtn = document.getElementById('btn-mode-taboo');
    if (tabooBtn) tabooBtn.addEventListener('click', hostStartTabooGame);

    // 房主發起 67 挑戰
    const btn67 = document.getElementById('btn-mode-67');
    if (btn67) btn67.addEventListener('click', () => {
        if (!state.amIHost) return;
        sendAction('START_67_GAME');
    });

    // 參與者拍照 / 上傳
    document.getElementById('btn-meeting-camera').onclick = () => handleMeetingPhotoClick('meeting-camera-input');
    document.getElementById('btn-meeting-album').onclick = () => handleMeetingPhotoClick('meeting-album-input');
    document.getElementById('meeting-camera-input').addEventListener('change', handleMeetingPhotoChange);
    document.getElementById('meeting-album-input').addEventListener('change', handleMeetingPhotoChange);

    // 邀請朋友
    const btnFocusInvite = document.getElementById('btn-focus-invite');
    if (btnFocusInvite) btnFocusInvite.onclick = openInviteModal;

    // 結束聚會
    document.getElementById('btn-end-session').onclick = handleEndSession;
}

function toggleFocusMembersPanel() {
    const panel = document.getElementById('focus-members-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}

function handleMeetingPhotoClick(inputId) {
    if (!state.roomId) {
        alert('聚會尚未建立');
        return;
    }
    startPhotoMode();
    const input = document.getElementById(inputId);
    input.value = '';
    input.click();
}

async function handleMeetingPhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    endPhotoMode();
    if (!file) return;
    const btn = e.target.id === 'meeting-camera-input'
        ? document.getElementById('btn-meeting-camera')
        : document.getElementById('btn-meeting-album');
    const origText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '⏳ 上傳中...';
    try {
        await uploadMeetingPhoto(state.roomId, file);
        btn.innerText = '✅ 上傳成功';
        setTimeout(() => { btn.innerText = origText; btn.disabled = false; }, 1500);
    } catch (err) {
        console.error('upload photo failed:', err);
        alert('照片上傳失敗:' + (err.message || err));
        btn.innerText = origText;
        btn.disabled = false;
    }
}

function handleEndSession() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        const mins = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0;
        const reason = state.amIHost ? 'host_ended' : 'member_ended';
        sendAction('END_SESSION', { reason, duration_minutes: mins });
        return;
    }
    // Fallback: WS 已斷線，只能本地切換
    state.currentPhase = 'SUMMARY';
    document.body.className = '';
    const timeMs = state.sessionStartTime ? Date.now() - state.sessionStartTime : 0;
    document.getElementById('summary-time').innerText = Math.round(timeMs / 60000);
    document.getElementById('summary-deviations').innerText = state.totalDeviations;
    if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
    import('../../core/router.js').then(({ switchView }) => switchView('view-summary'));
}
