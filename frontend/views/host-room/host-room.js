// views/host-room/host-room.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction, closeWs } from '../../core/ws.js';
import { cleanupSession, updateThemeByMode } from '../../core/session.js';
import { copyInviteLink } from '../invite-modal/invite-modal.js';

export function init() {
    register('view-host-room', { element: document.getElementById('view-host-room') });

    // 複製聚會連結
    const btnCopy = document.getElementById('btn-copy-room-link');
    if (btnCopy) btnCopy.addEventListener('click', () => copyInviteLink());

    // 取消聚會
    const btnCancel = document.getElementById('btn-cancel-host-room');
    if (btnCancel) btnCancel.addEventListener('click', handleCancelHostRoom);

    // 開始同步定錨
    const btnStart = document.getElementById('btn-start-sync');
    if (btnStart) {
        btnStart.onclick = () => {
            if (btnStart.classList.contains('disabled')) return;
            sendAction('START_SYNC');
        };
    }

    // 模式切換按鈕 — 用 event delegation 在 document 層處理
    document.addEventListener('click', handleModeBtnClick);
}

function setActiveModeBtn(clickedBtnId) {
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active-mode'));
    if (clickedBtnId) {
        const activeBtn = document.getElementById(clickedBtnId);
        if (activeBtn) activeBtn.classList.add('active-mode');
    }
}

function handleModeBtnClick(e) {
    const modeBtn = e.target.closest('.mode-btn');
    if (!modeBtn) return;
    const btnId = modeBtn.id;
    setActiveModeBtn(btnId);

    if (btnId === 'btn-mode-gathering') state.currentRoomMode = "GATHERING";
    else if (btnId === 'btn-mode-family') state.currentRoomMode = "FAMILY";
    else if (btnId === 'btn-mode-meeting') state.currentRoomMode = "MEETING";
    else if (btnId === 'btn-mode-class') state.currentRoomMode = "CLASS";

    updateThemeByMode(state.currentRoomMode);
    sendAction('CHANGE_MODE', { mode: state.currentRoomMode });
}

async function handleCancelHostRoom(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[cancel-host-room] clicked, roomId=', state.roomId);

    const memberCountEl = document.getElementById('member-count');
    const raw = memberCountEl ? (memberCountEl.innerText || memberCountEl.textContent || '0') : '0';
    const memberCount = parseInt(raw, 10) || 0;
    if (memberCount > 1) {
        if (!confirm(`目前已有 ${memberCount} 人加入,確定取消聚會嗎?`)) return;
    }

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        try {
            sendAction('CANCEL_ROOM');
            await new Promise(r => setTimeout(r, 200));
        } catch (err) {
            console.warn('CANCEL_ROOM broadcast failed:', err);
        }
    }
    switchView('view-home');
    try { cleanupSession(); } catch (err) { console.warn('cleanupSession err:', err); }
    setTimeout(() => switchView('view-home'), 0);
}
