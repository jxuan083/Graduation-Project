// views/sync-ritual/sync-ritual.js — 多人共同定錨儀式
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { t } from '../../core/i18n.js';

const RING_CIRCUMFERENCE = 691.15; // 2πr，r=110
const HOLD_TICK_MS = 50;
const PROGRESS_PER_TICK = 2;
const NETWORK_STEP = 4;

let activePointerId = null;
let lastSentProgress = -1;
let lastHapticMilestone = 0;
const readyMembers = new Set();

export function init() {
    register('view-sync-ritual', {
        element: document.getElementById('view-sync-ritual'),
        onHide: stopHoldWithoutReset,
    });

    const btnHold = document.getElementById('btn-sync-hold');
    if (!btnHold) return;

    btnHold.addEventListener('pointerdown', startHold);
    btnHold.addEventListener('pointerup', endHold);
    btnHold.addEventListener('pointercancel', endHold);
    btnHold.addEventListener('lostpointercapture', endHold);
    btnHold.addEventListener('keydown', handleKeyDown);
    btnHold.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', endHold);
}

export function resetSyncRitual(members = {}) {
    stopHoldWithoutReset();
    state.isReady = false;
    state.myProgress = 0;
    state.roomMembers = members || state.roomMembers || {};
    activePointerId = null;
    lastSentProgress = -1;
    lastHapticMilestone = 0;
    readyMembers.clear();

    const overlay = document.getElementById('sync-complete-overlay');
    if (overlay) overlay.hidden = true;

    updateLocalProgress(0);
    renderSyncMembers(state.roomMembers);
}

export function renderSyncMembers(members = {}) {
    state.roomMembers = members || {};
    const grid = document.getElementById('sync-member-grid');
    if (!grid) return;

    const previousReady = new Set(readyMembers);
    readyMembers.clear();
    grid.innerHTML = '';

    const entries = Object.entries(state.roomMembers);
    let readyCount = 0;
    let holdingCount = 0;

    for (const [uid, info = {}] of entries) {
        const progress = clampProgress(info.progress);
        const isReady = progress >= 100;
        const isHolding = progress > 0 && !isReady;
        if (isReady) {
            readyCount += 1;
            readyMembers.add(uid);
        }
        if (isHolding) holdingCount += 1;

        const person = document.createElement('div');
        person.className = 'sync-person';
        if (uid === state.userId) person.classList.add('is-me');
        if (isHolding) person.classList.add('is-holding');
        if (isReady) person.classList.add('is-ready');
        if (isReady && !previousReady.has(uid)) person.classList.add('just-ready');

        const ring = document.createElement('span');
        ring.className = 'sync-person-ring';
        ring.style.setProperty('--member-progress', `${progress * 3.6}deg`);

        const initial = document.createElement('span');
        initial.className = 'sync-person-initial';
        const nickname = String(info.nickname || t('夥伴')).trim();
        initial.textContent = (nickname[0] || '?').toUpperCase();
        ring.appendChild(initial);

        const name = document.createElement('span');
        name.className = 'sync-person-name';
        name.textContent = uid === state.userId ? t('{name}（你）', { name: nickname }) : nickname;

        person.append(ring, name);
        grid.appendChild(person);
    }

    updateSharedStatus({ total: entries.length, readyCount, holdingCount });
}

export function showAnchorEstablished() {
    stopHoldWithoutReset();
    updateLocalProgress(100);
    const overlay = document.getElementById('sync-complete-overlay');
    if (overlay) overlay.hidden = false;
    vibrate([35, 35, 70]);
    return new Promise(resolve => setTimeout(resolve, prefersReducedMotion() ? 120 : 950));
}

function startHold(event) {
    if (state.currentPhase !== 'SYNC' || state.isReady || state.holdInterval) return;
    if (event.type === 'pointerdown' && event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();

    const btnHold = document.getElementById('btn-sync-hold');
    if (event.pointerId !== undefined) {
        activePointerId = event.pointerId;
        btnHold?.setPointerCapture?.(event.pointerId);
    }
    btnHold?.classList.add('holding');
    document.getElementById('sync-pulse')?.classList.add('visible');
    vibrate(12);

    state.holdInterval = setInterval(() => {
        state.myProgress = Math.min(100, state.myProgress + PROGRESS_PER_TICK);
        updateLocalProgress(state.myProgress);
        updateLocalMemberProgress(state.myProgress);
        maybeVibrateMilestone(state.myProgress);

        if (state.myProgress - lastSentProgress >= NETWORK_STEP || state.myProgress === 100) {
            lastSentProgress = state.myProgress;
            sendAction('SYNC_PROGRESS', { progress: state.myProgress });
        }

        if (state.myProgress >= 100) {
            state.isReady = true;
            stopHoldWithoutReset();
            btnHold?.classList.add('done');
            const label = document.getElementById('sync-hold-label');
            if (label) label.textContent = t('已定錨');
            vibrate([20, 30, 35]);
        }
    }, HOLD_TICK_MS);
}

function endHold(event) {
    if (event?.pointerId !== undefined && activePointerId !== null && event.pointerId !== activePointerId) return;
    activePointerId = null;
    if (state.currentPhase !== 'SYNC' || state.isReady || !state.holdInterval) return;

    stopHoldWithoutReset();
    state.myProgress = 0;
    lastSentProgress = 0;
    lastHapticMilestone = 0;
    updateLocalProgress(0);
    updateLocalMemberProgress(0);
    sendAction('SYNC_PROGRESS', { progress: 0 });
    vibrate(8);
}

function handleKeyDown(event) {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) startHold(event);
}

function handleKeyUp(event) {
    if (event.key === ' ' || event.key === 'Enter') endHold(event);
}

function stopHoldWithoutReset() {
    if (state.holdInterval) clearInterval(state.holdInterval);
    state.holdInterval = null;
    document.getElementById('btn-sync-hold')?.classList.remove('holding');
    document.getElementById('sync-pulse')?.classList.remove('visible');
}

function updateLocalProgress(progress) {
    const pct = clampProgress(progress);
    const ring = document.getElementById('sync-progress-fill');
    if (ring) ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - pct / 100));

    const btnHold = document.getElementById('btn-sync-hold');
    if (btnHold) {
        btnHold.style.setProperty('--sync-fill-scale', String(pct / 100));
        btnHold.classList.toggle('done', pct >= 100);
    }

    const percent = document.getElementById('sync-hold-percent');
    if (percent) percent.textContent = `${pct}%`;

    const label = document.getElementById('sync-hold-label');
    if (label && pct < 100) label.textContent = pct > 0 ? t('不要放開') : t('按住定錨');
}

function updateLocalMemberProgress(progress) {
    const members = { ...(state.roomMembers || {}) };
    members[state.userId] = {
        ...(members[state.userId] || {}),
        nickname: members[state.userId]?.nickname || state.myNickname || t('我'),
        progress,
    };
    renderSyncMembers(members);
}

function updateSharedStatus({ total, readyCount, holdingCount }) {
    const title = document.getElementById('sync-progress-text');
    const detail = document.getElementById('sync-progress-detail');
    if (!title || !detail) return;

    if (!total) {
        title.textContent = t('正在召集夥伴');
        detail.textContent = t('成員加入後，大家會在這裡一起定錨');
    } else if (readyCount === total) {
        title.textContent = t('大家都定錨了');
        detail.textContent = t('聚會即將開始');
    } else if (state.isReady) {
        title.textContent = t('你已經準備好了');
        detail.textContent = t('再等 {count} 位夥伴完成', { count: total - readyCount });
    } else if (holdingCount > 1) {
        title.textContent = t('{count} 人正在一起定錨', { count: holdingCount });
        detail.textContent = t('保持按住，跟上彼此的節奏');
    } else {
        title.textContent = t('{ready}/{total} 位已定錨', { ready: readyCount, total });
        detail.textContent = t('按住中央按鈕，直到自己的圓圈完成');
    }
}

function maybeVibrateMilestone(progress) {
    const milestone = Math.floor(progress / 25) * 25;
    if (milestone > lastHapticMilestone && milestone < 100) {
        lastHapticMilestone = milestone;
        vibrate(10);
    }
}

function clampProgress(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
}

function vibrate(pattern) {
    try { navigator.vibrate?.(pattern); } catch (_) { /* unsupported */ }
}

function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
