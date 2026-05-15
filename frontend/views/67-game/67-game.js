// views/67-game/67-game.js — 67 挑戰 SOTA 版
// Server-side timer + combo + haptic + live scores + replay
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';

const GAME_DURATION = 20;
let tapCount = 0;
let gameTimer = null;
let secondsLeft = 0;
let cameraStream = null;
let armToggle = false;
let resultTimeout = null;

// Combo 系統
let tapTimestamps = [];
let currentComboLevel = 0;
const COMBO_THRESHOLDS = [
    { tps: 5,  cls: 'combo-hot',     label: 'NICE!' },
    { tps: 8,  cls: 'combo-fire',    label: 'COMBO!' },
    { tps: 12, cls: 'combo-inferno', label: 'INSANE!' },
];

export function init() {
    register('view-67-game', { element: document.getElementById('view-67-game') });

    document.getElementById('btn-67-ready').onclick = playerReady;
    document.getElementById('btn-67-tap').onclick = handleTap;
    document.getElementById('btn-67-back').onclick = returnToFocus;
    document.getElementById('btn-67-replay').onclick = () => sendAction('RESTART_67_GAME');

    const cancelBtn = document.getElementById('btn-67-cancel');
    if (cancelBtn) cancelBtn.onclick = () => sendAction('CANCEL_67_GAME');

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && isPlayPhaseActive()) {
            e.preventDefault();
            handleTap();
        }
    });
}

function isPlayPhaseActive() {
    const el = document.getElementById('game67-play-phase');
    return el && el.style.display !== 'none';
}

// ===== Phase 0: 規則 + 準備 =====

export function enterReadyPhase() {
    tapCount = 0;
    armToggle = false;
    tapTimestamps = [];
    currentComboLevel = 0;

    showPhase('ready');
    document.getElementById('btn-67-ready').disabled = false;
    document.getElementById('btn-67-ready').textContent = '了解！準備好了';
    document.getElementById('game67-waiting-hint').style.display = 'none';

    const cancelBtn = document.getElementById('btn-67-cancel');
    if (cancelBtn) cancelBtn.style.display = state.amIHost ? '' : 'none';
}

function playerReady() {
    document.getElementById('btn-67-ready').disabled = true;
    document.getElementById('btn-67-ready').textContent = '已準備';
    document.getElementById('game67-waiting-hint').style.display = '';
    sendAction('GAME67_READY');
}

// ===== Phase 1: 倒數 3-2-1 =====

export async function startPreCountdown() {
    await startCamera();
    showPhase('countdown');

    let count = 3;
    const el = document.getElementById('game67-pre-countdown');
    el.textContent = count;
    el.className = 'game67-big-num game67-count-enter';

    const intv = setInterval(() => {
        count--;
        if (count > 0) {
            el.textContent = count;
            el.className = 'game67-big-num game67-count-enter';
        } else {
            el.textContent = 'GO!';
            el.className = 'game67-big-num game67-count-go';
            clearInterval(intv);
            setTimeout(() => startPlayPhase(), 500);
        }
    }, 1000);
}

async function startCamera() {
    const liveCam = document.getElementById('game67-live-cam');
    const fallback = document.getElementById('game67-avatar-fallback');
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 240 }, height: { ideal: 240 } },
            audio: false,
        });
        liveCam.srcObject = cameraStream;
        liveCam.style.display = '';
        fallback.style.display = 'none';
    } catch (err) {
        console.warn('[67] camera denied, using fallback');
        liveCam.style.display = 'none';
        fallback.style.display = 'flex';
        fallback.textContent = (state.myNickname || '?')[0];
    }
}

// ===== Phase 2: 遊戲進行 =====

function startPlayPhase() {
    showPhase('play');
    tapCount = 0;
    secondsLeft = GAME_DURATION;
    tapTimestamps = [];
    currentComboLevel = 0;

    document.getElementById('game67-tap-count').textContent = '0';
    document.getElementById('game67-tap-count').className = 'game67-tap-count';
    document.getElementById('game67-seconds-left').textContent = secondsLeft;
    document.getElementById('game67-timer-fill').style.width = '100%';
    document.getElementById('game67-combo').textContent = '';
    document.getElementById('game67-combo').className = 'game67-combo';
    document.getElementById('game67-opponents').innerHTML = '';
    document.getElementById('game67-play-phase').classList.remove('urgency');
    resetArms();

    gameTimer = setInterval(() => {
        secondsLeft--;
        document.getElementById('game67-seconds-left').textContent = Math.max(0, secondsLeft);
        document.getElementById('game67-timer-fill').style.width = `${(secondsLeft / GAME_DURATION) * 100}%`;

        if (secondsLeft <= 5) {
            document.getElementById('game67-play-phase').classList.add('urgency');
        }
        if (secondsLeft <= 0) {
            clearInterval(gameTimer);
            gameTimer = null;
            endGame();
        }
    }, 1000);
}

function handleTap() {
    if (!gameTimer) return;

    tapCount++;
    const countEl = document.getElementById('game67-tap-count');
    countEl.textContent = tapCount;

    // C4: 分數跳動
    countEl.classList.remove('score-pop');
    requestAnimationFrame(() => requestAnimationFrame(() => countEl.classList.add('score-pop')));

    // B2: 觸覺回饋
    if (navigator.vibrate) navigator.vibrate(12);

    animateArms();
    updateCombo();

    if (tapCount % 3 === 0) {
        sendAction('GAME67_TAP_UPDATE', { count: tapCount });
    }
}

// ===== Combo =====

function updateCombo() {
    const now = Date.now();
    tapTimestamps.push(now);
    tapTimestamps = tapTimestamps.filter(t => now - t < 1000);
    const tps = tapTimestamps.length;

    let newLevel = 0;
    for (let i = COMBO_THRESHOLDS.length - 1; i >= 0; i--) {
        if (tps >= COMBO_THRESHOLDS[i].tps) { newLevel = i + 1; break; }
    }

    if (newLevel !== currentComboLevel) {
        currentComboLevel = newLevel;
        const countEl = document.getElementById('game67-tap-count');
        const comboEl = document.getElementById('game67-combo');

        COMBO_THRESHOLDS.forEach(t => countEl.classList.remove(t.cls));

        if (newLevel > 0) {
            const t = COMBO_THRESHOLDS[newLevel - 1];
            countEl.classList.add(t.cls);
            comboEl.textContent = t.label;
            comboEl.className = 'game67-combo game67-combo-show';
            if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
        } else {
            comboEl.className = 'game67-combo';
        }
    }
}

// ===== 角色動畫 =====

function animateArms() {
    armToggle = !armToggle;
    const lA = document.getElementById('game67-arm-left');
    const rA = document.getElementById('game67-arm-right');
    const lL = document.getElementById('game67-leg-left');
    const rL = document.getElementById('game67-leg-right');

    if (armToggle) {
        lA.classList.add('arm-up');   lA.classList.remove('arm-down');
        rA.classList.add('arm-down'); rA.classList.remove('arm-up');
        lL.classList.add('leg-kick'); rL.classList.remove('leg-kick');
    } else {
        lA.classList.add('arm-down'); lA.classList.remove('arm-up');
        rA.classList.add('arm-up');   rA.classList.remove('arm-down');
        rL.classList.add('leg-kick'); lL.classList.remove('leg-kick');
    }
}

function resetArms() {
    document.getElementById('game67-arm-left').className = 'game67-arm game67-arm-left';
    document.getElementById('game67-arm-right').className = 'game67-arm game67-arm-right';
    document.getElementById('game67-leg-left').className = 'game67-leg game67-leg-left';
    document.getElementById('game67-leg-right').className = 'game67-leg game67-leg-right';
}

function endGame() {
    sendAction('GAME67_FINISH', { count: tapCount });
    document.getElementById('game67-my-final-score').textContent = tapCount;
    stopCamera();
}

// ===== B5: 即時對手分數 =====

export function updateLiveScores(scores) {
    const container = document.getElementById('game67-opponents');
    if (!container || !isPlayPhaseActive()) return;
    container.innerHTML = '';
    for (const [uid, count] of Object.entries(scores)) {
        if (uid === state.userId) continue;
        const pill = document.createElement('span');
        pill.className = 'game67-opp-pill';
        pill.innerHTML = `<span class="game67-opp-count">${count}</span>`;
        container.appendChild(pill);
    }
}

// ===== GAME67_TIME_SYNC =====

export function syncTime(serverSecondsLeft) {
    if (!gameTimer) return;
    if (Math.abs(secondsLeft - serverSecondsLeft) >= 2) {
        secondsLeft = serverSecondsLeft;
        document.getElementById('game67-seconds-left').textContent = Math.max(0, secondsLeft);
        document.getElementById('game67-timer-fill').style.width = `${(secondsLeft / GAME_DURATION) * 100}%`;
    }
}

// ===== Phase 3: 結果 =====

export function showResults(scores) {
    showPhase('result');
    document.getElementById('game67-my-final-score').textContent = tapCount;

    const ul = document.getElementById('game67-leaderboard');
    ul.innerHTML = '';

    scores.forEach((entry, i) => {
        const li = document.createElement('li');
        li.className = 'game67-lb-entry';
        if (i === 0) li.classList.add('game67-lb-first');
        li.style.animationDelay = `${i * 0.08}s`;

        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        const isMe = entry.user_id === state.userId;
        li.innerHTML = `
            <span class="game67-lb-rank">${medal}</span>
            <span class="game67-lb-name${isMe ? ' game67-lb-me' : ''}">${escHtml(entry.nickname)}</span>
            <span class="game67-lb-score">${entry.count} 次</span>
        `;
        ul.appendChild(li);
    });

    document.getElementById('btn-67-replay').style.display = state.amIHost ? '' : 'none';
    document.getElementById('game67-return-hint').textContent = state.amIHost ? '' : '等待房主決定...';

    if (resultTimeout) clearTimeout(resultTimeout);
    resultTimeout = setTimeout(() => {
        resultTimeout = null;
        if (document.getElementById('game67-result-phase')?.style.display !== 'none') {
            returnToFocus();
        }
    }, 15000);
}

export function handleCancelled() {
    cleanup67Game();
    returnToFocus();
}

function returnToFocus() {
    cleanup67Game();
    state.currentPhase = 'ACTIVE';
    switchView('view-focus');
    document.body.classList.add('mode-flow');
}

// ===== Helpers =====

function showPhase(phase) {
    ['ready', 'countdown', 'play', 'result'].forEach(p => {
        const el = document.getElementById(`game67-${p}-phase`);
        if (el) el.style.display = p === phase ? '' : 'none';
    });
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
}

export function cleanup67Game() {
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }
    stopCamera();
    tapCount = 0;
    tapTimestamps = [];
    currentComboLevel = 0;
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
