// views/sync-ritual/sync-ritual.js
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';

export function init() {
    register('view-sync-ritual', { element: document.getElementById('view-sync-ritual') });

    const btnHold = document.getElementById('btn-sync-hold');
    if (!btnHold) return;
    btnHold.addEventListener('touchstart', startHold, { passive: false });
    btnHold.addEventListener('mousedown', startHold);
    btnHold.addEventListener('touchend', endHold);
    btnHold.addEventListener('mouseup', endHold);
    btnHold.addEventListener('mouseleave', endHold);
}

function startHold(e) {
    if (e.type === 'touchstart') e.preventDefault();
    if (state.currentPhase !== 'SYNC' || state.isReady) return;

    const btnHold = document.getElementById('btn-sync-hold');
    const progressFill = document.getElementById('sync-progress-fill');

    state.holdInterval = setInterval(() => {
        state.myProgress += 2;
        if (state.myProgress >= 100) {
            state.myProgress = 100;
            state.isReady = true;
            progressFill.style.background = "linear-gradient(90deg, #10b981, #34d399)";
            btnHold.innerText = "READY";
            btnHold.style.background = "#10b981";
            clearInterval(state.holdInterval);
        }
        progressFill.style.width = state.myProgress + '%';
        sendAction('SYNC_PROGRESS', { progress: state.myProgress });
    }, 50);
}

function endHold() {
    if (state.currentPhase !== 'SYNC' || state.isReady) return;
    clearInterval(state.holdInterval);
    state.myProgress = 0;
    const progressFill = document.getElementById('sync-progress-fill');
    if (progressFill) progressFill.style.width = '0%';
    sendAction('SYNC_PROGRESS', { progress: 0 });
}
