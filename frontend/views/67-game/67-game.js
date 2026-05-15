// views/67-game/67-game.js — 67 挑戰：20 秒狂按 + 虛擬角色做 67 動作（鏡頭當頭）
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';

const GAME_DURATION = 20;
let tapCount = 0;
let gameTimer = null;
let secondsLeft = 0;
let cameraStream = null;
let armToggle = false;

export function init() {
    register('view-67-game', { element: document.getElementById('view-67-game') });
    document.getElementById('btn-67-ready').onclick = playerReady;
    document.getElementById('btn-67-tap').onclick = handleTap;

    // 空白鍵也能按
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

// ===== Phase 1: 準備 =====

export function enterReadyPhase() {
    tapCount = 0;
    armToggle = false;
    showPhase('selfie'); // reuse selfie-phase div as ready phase
    document.getElementById('btn-67-ready').disabled = false;
    document.getElementById('btn-67-ready').textContent = '準備好了！';
    document.getElementById('game67-waiting-hint').style.display = 'none';
}

function playerReady() {
    document.getElementById('btn-67-ready').disabled = true;
    document.getElementById('btn-67-ready').textContent = '已準備';
    document.getElementById('game67-waiting-hint').style.display = '';
    sendAction('GAME67_READY');
}

// ===== Phase 2: 倒數 3-2-1 =====

export async function startPreCountdown() {
    // 先開鏡頭
    await startCamera();

    showPhase('countdown');
    let count = 3;
    const el = document.getElementById('game67-pre-countdown');
    el.textContent = count;

    const intv = setInterval(() => {
        count--;
        if (count > 0) {
            el.textContent = count;
        } else {
            el.textContent = 'GO!';
            clearInterval(intv);
            setTimeout(() => startPlayPhase(), 400);
        }
    }, 1000);
}

async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 240 }, height: { ideal: 240 } },
            audio: false,
        });
        const liveCam = document.getElementById('game67-live-cam');
        if (liveCam) liveCam.srcObject = cameraStream;
    } catch (err) {
        console.error('[67] camera failed:', err);
    }
}

// ===== Phase 3: 遊戲進行 =====

function startPlayPhase() {
    showPhase('play');
    tapCount = 0;
    secondsLeft = GAME_DURATION;

    document.getElementById('game67-tap-count').textContent = '0';
    document.getElementById('game67-seconds-left').textContent = secondsLeft;
    document.getElementById('game67-timer-fill').style.width = '100%';
    resetArms();

    gameTimer = setInterval(() => {
        secondsLeft--;
        document.getElementById('game67-seconds-left').textContent = Math.max(0, secondsLeft);
        document.getElementById('game67-timer-fill').style.width = `${(secondsLeft / GAME_DURATION) * 100}%`;

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
    document.getElementById('game67-tap-count').textContent = tapCount;
    animateArms();

    // 每 5 次同步分數
    if (tapCount % 5 === 0) {
        sendAction('GAME67_TAP_UPDATE', { count: tapCount });
    }
}

function animateArms() {
    armToggle = !armToggle;
    const leftArm = document.getElementById('game67-arm-left');
    const rightArm = document.getElementById('game67-arm-right');

    if (armToggle) {
        leftArm.classList.add('arm-up');
        leftArm.classList.remove('arm-down');
        rightArm.classList.add('arm-down');
        rightArm.classList.remove('arm-up');
    } else {
        leftArm.classList.add('arm-down');
        leftArm.classList.remove('arm-up');
        rightArm.classList.add('arm-up');
        rightArm.classList.remove('arm-down');
    }
}

function resetArms() {
    document.getElementById('game67-arm-left').className = 'game67-arm game67-arm-left';
    document.getElementById('game67-arm-right').className = 'game67-arm game67-arm-right';
}

function endGame() {
    sendAction('GAME67_FINISH', { count: tapCount });
    document.getElementById('game67-my-final-score').textContent = tapCount;
    stopCamera();
}

// ===== Phase 4: 結果 =====

export function showResults(scores) {
    showPhase('result');
    document.getElementById('game67-my-final-score').textContent = tapCount;

    const ul = document.getElementById('game67-leaderboard');
    ul.innerHTML = '';

    scores.forEach((entry, i) => {
        const li = document.createElement('li');
        li.className = 'game67-lb-entry';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        const isMe = entry.user_id === state.userId;
        li.innerHTML = `
            <span class="game67-lb-rank">${medal}</span>
            <span class="game67-lb-name${isMe ? ' game67-lb-me' : ''}">${escHtml(entry.nickname)}</span>
            <span class="game67-lb-score">${entry.count} 次</span>
        `;
        ul.appendChild(li);
    });

    let countdown = 5;
    const hint = document.getElementById('game67-return-hint');
    hint.textContent = `${countdown} 秒後返回聚會畫面...`;
    const intv = setInterval(() => {
        countdown--;
        hint.textContent = `${countdown} 秒後返回聚會畫面...`;
        if (countdown <= 0) {
            clearInterval(intv);
            state.currentPhase = 'ACTIVE';
            switchView('view-focus');
            document.body.classList.add('mode-flow');
        }
    }, 1000);
}

// ===== Helpers =====

function showPhase(phase) {
    ['selfie', 'countdown', 'play', 'result'].forEach(p => {
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
    stopCamera();
    tapCount = 0;
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
