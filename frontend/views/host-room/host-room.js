// views/host-room/host-room.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { cleanupSession } from '../../core/session.js';
import { copyInviteLink } from '../invite-modal/invite-modal.js';
import { CONTEXT_CONFIGS, DIFFICULTY_LABELS } from '../../core/config.js';
import { t } from '../../core/i18n.js';

export function init() {
    register('view-host-room', {
        element: document.getElementById('view-host-room'),
        onShow: updateContextBadge,
    });

    // 複製聚會連結
    const btnCopy = document.getElementById('btn-copy-room-link');
    if (btnCopy) btnCopy.addEventListener('click', () => copyInviteLink());

    // 取消聚會（底部 + 左上返回都視為離開房間）
    const btnCancel = document.getElementById('btn-cancel-host-room');
    if (btnCancel) btnCancel.addEventListener('click', handleCancelHostRoom);
    const btnBack = document.getElementById('btn-host-back');
    if (btnBack) btnBack.addEventListener('click', handleCancelHostRoom);

    // 開始同步定錨
    const btnStart = document.getElementById('btn-start-sync');
    if (btnStart) {
        btnStart.onclick = () => {
            if (btnStart.classList.contains('disabled')) return;
            sendAction('START_SYNC');
        };
    }
}

function updateContextBadge() {
    const badge = document.getElementById('room-context-badge');
    const ctxLabel = document.getElementById('room-context-label');
    const diffBadge = document.getElementById('room-difficulty-badge');
    if (!badge) return;
    const ctx = state.currentContext || 'general';
    const diff = state.currentDifficulty || 'M';
    const cfg = CONTEXT_CONFIGS[ctx] || CONTEXT_CONFIGS.general;
    if (ctxLabel) ctxLabel.innerHTML = `<i data-lucide="${cfg.icon}"></i> ${cfg.label}`;
    if (diffBadge) {
        diffBadge.textContent = DIFFICULTY_LABELS[diff] || diff;
        diffBadge.className = `diff-badge diff-${diff.toLowerCase()}`;
    }
    badge.style.display = '';
}

async function handleCancelHostRoom(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[cancel-host-room] clicked, roomId=', state.roomId);

    const memberCountEl = document.getElementById('member-count');
    const raw = memberCountEl ? (memberCountEl.innerText || memberCountEl.textContent || '0') : '0';
    const memberCount = parseInt(raw, 10) || 0;
    if (memberCount > 1) {
        if (!confirm(t('目前已有 {count} 人加入，確定取消聚會嗎？', { count: memberCount }))) return;
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
