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

// 圓環周長 = 2πr，r=110 → 691.15（與 HTML 的 stroke-dasharray 一致）
const RING_CIRCUMFERENCE = 691.15;

function setRingProgress(pct) {
    const ring = document.getElementById('sync-progress-fill');
    if (ring) ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - pct / 100));
}

function startHold(e) {
    if (e.type === 'touchstart') e.preventDefault();
    if (state.currentPhase !== 'SYNC' || state.isReady) return;

    const btnHold = document.getElementById('btn-sync-hold');
    const label = document.getElementById('sync-hold-label');
    const pulse = document.getElementById('sync-pulse');
    if (btnHold) btnHold.classList.add('holding');
    if (pulse) pulse.classList.add('visible');

    state.holdInterval = setInterval(() => {
        state.myProgress += 2;
        if (state.myProgress >= 100) {
            state.myProgress = 100;
            state.isReady = true;
            if (btnHold) { btnHold.classList.remove('holding'); btnHold.classList.add('done'); }
            if (label) label.innerText = 'READY';
            if (pulse) pulse.classList.remove('visible');
            clearInterval(state.holdInterval);
        }
        setRingProgress(state.myProgress);
        sendAction('SYNC_PROGRESS', { progress: state.myProgress });
    }, 50);
}

function endHold() {
    if (state.currentPhase !== 'SYNC' || state.isReady) return;
    clearInterval(state.holdInterval);
    state.myProgress = 0;
    setRingProgress(0);
    const btnHold = document.getElementById('btn-sync-hold');
    const pulse = document.getElementById('sync-pulse');
    if (btnHold) btnHold.classList.remove('holding');
    if (pulse) pulse.classList.remove('visible');
    sendAction('SYNC_PROGRESS', { progress: 0 });
}
