// views/buffer/buffer.js — 分心倒數提醒
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';

export function init() {
    register('view-buffer', { element: document.getElementById('view-buffer') });

    // 「我回來專心了」按鈕 — 不計分心
    document.getElementById('btn-buffer-back').onclick = () => {
        endCognitiveBuffer(true);
        sendAction('VISIBILITY_CHANGE', { state: 'hidden' });
    };

    // 監聽頁面可見性變化
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange() {
    if (state.currentPhase !== 'ACTIVE') return;
    if (state.photoModeActive) return;

    if (document.visibilityState === 'visible') {
        // 如果倒數已經在跑，不要重新開始（避免反覆切換分頁重置計時器）
        if (!state.bufferTimerObj) {
            startCognitiveBuffer();
        }
        sendAction('VISIBILITY_CHANGE', { state: 'visible' });
    } else {
        // 倒數進行中時不要取消，讓計時器繼續跑（超時會自動記錄分心）
        if (!state.bufferTimerObj) {
            sendAction('VISIBILITY_CHANGE', { state: 'hidden' });
        }
    }
}

export function startCognitiveBuffer() {
    if (state.bufferTimerObj) {
        clearInterval(state.bufferTimerObj);
        state.bufferTimerObj = null;
    }
    switchView('view-buffer');
    document.body.classList.remove('mode-flow');
    document.body.classList.add('mode-danger');

    state.bufferSecondsLeft = 30;
    document.getElementById('buffer-timer').innerText = state.bufferSecondsLeft;

    if (navigator.vibrate) navigator.vibrate(200);

    state.bufferTimerObj = setInterval(() => {
        state.bufferSecondsLeft--;
        document.getElementById('buffer-timer').innerText = state.bufferSecondsLeft;
        if (state.bufferSecondsLeft <= 0) {
            clearInterval(state.bufferTimerObj);
            state.bufferTimerObj = null;
            handleBufferTimeout();
        }
    }, 1000);
}

export function endCognitiveBuffer(safe) {
    clearInterval(state.bufferTimerObj);
    state.bufferTimerObj = null;
    if (safe) {
        switchView('view-focus');
        document.body.classList.remove('mode-danger');
        document.body.classList.add('mode-flow');
    }
}

function handleBufferTimeout() {
    sendAction('LOG_DEVIATION');

    // 如果使用者還在別的分頁，重新開始 30 秒倒數（持續累計分心次數）
    if (document.visibilityState === 'hidden') {
        state.bufferSecondsLeft = 30;
        document.getElementById('buffer-timer').innerText = state.bufferSecondsLeft;
        state.bufferTimerObj = setInterval(() => {
            state.bufferSecondsLeft--;
            document.getElementById('buffer-timer').innerText = state.bufferSecondsLeft;
            if (state.bufferSecondsLeft <= 0) {
                clearInterval(state.bufferTimerObj);
                state.bufferTimerObj = null;
                handleBufferTimeout();
            }
        }, 1000);
        return;
    }

    // 使用者在當前分頁，顯示懲罰動畫後恢復
    state.bufferTimerObj = null;
    document.getElementById('lottie-orb').style.filter = 'grayscale(100%) opacity(0.5)';
    switchView('view-focus');
    document.body.classList.remove('mode-danger');
    setTimeout(() => {
        document.getElementById('lottie-orb').style.filter = 'none';
        document.body.classList.add('mode-flow');
    }, 5000);
}
