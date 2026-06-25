// views/buffer/buffer.js — 分心倒數提醒
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { events } from '../../core/events.js';
import { reconnectSilent } from '../../core/session.js';

export function init() {
    register('view-buffer', { element: document.getElementById('view-buffer') });

    // 「我回來專心了」按鈕 — 清除計時，回 focus，不計分心
    document.getElementById('btn-buffer-back').onclick = () => {
        endCognitiveBuffer(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // WS 重連後補送暫存的分心次數
    events.on('ws:open', () => {
        if (state.pendingDeviation > 0 && state.currentPhase === 'ACTIVE') {
            sendAction('LOG_DEVIATION', { count: state.pendingDeviation });
            state.pendingDeviation = 0;
        }
    });
}

function handleVisibilityChange() {
    if (state.currentPhase !== 'ACTIVE') return;
    if (state.photoModeActive) return;

    if (document.visibilityState === 'visible') {
        // 停止背景計時器
        clearTimeout(state.hiddenTimerObj);
        state.hiddenTimerObj = null;
        state.hiddenAt = null;

        if (!state.deviationDeadline) {
            // 首次回來：起算 15 秒截止時間
            state.deviationDeadline = Date.now() + 15000;
            startCognitiveBuffer(15);
        } else {
            const remaining = state.deviationDeadline - Date.now();
            if (remaining <= 0) {
                // 背景計時器已觸發並計分心，直接回 focus
                endCognitiveBuffer(true);
            } else {
                // 繼續顯示剩餘倒數
                startCognitiveBuffer(Math.ceil(remaining / 1000));
            }
        }

        sendAction('VISIBILITY_CHANGE', { state: 'visible' });
    } else {
        // 用戶離開
        state.hiddenAt = Date.now();

        // 若尚未有截止時間，現在起算 15 秒
        if (!state.deviationDeadline) {
            state.deviationDeadline = Date.now() + 15000;
        }

        // 把前景倒數轉為背景計時器（繼承剩餘時間）
        clearInterval(state.bufferTimerObj);
        state.bufferTimerObj = null;

        const remaining = Math.max(state.deviationDeadline - Date.now(), 0);
        state.hiddenTimerObj = setTimeout(deviationFired, remaining);

        sendAction('VISIBILITY_CHANGE', { state: 'hidden' });
    }
}

export function startCognitiveBuffer(seconds = 15) {
    clearInterval(state.bufferTimerObj);
    state.bufferTimerObj = null;

    switchView('view-buffer');
    document.body.classList.remove('mode-flow');
    document.body.classList.add('mode-danger');

    state.bufferSecondsLeft = seconds;
    document.getElementById('buffer-timer').innerText = state.bufferSecondsLeft;

    if (navigator.vibrate) navigator.vibrate(200);

    state.bufferTimerObj = setInterval(() => {
        state.bufferSecondsLeft--;
        document.getElementById('buffer-timer').innerText = state.bufferSecondsLeft;
        if (state.bufferSecondsLeft <= 0) {
            clearInterval(state.bufferTimerObj);
            state.bufferTimerObj = null;
            deviationFired();
        }
    }, 1000);
}

// 統一處理分心事件：前景倒數歸零 或 背景計時器到期，都走這裡
function deviationFired() {
    if (!sendAction('LOG_DEVIATION', { count: 1 })) {
        state.pendingDeviation = (state.pendingDeviation || 0) + 1;
        reconnectSilent();
    }

    // 設定下一輪 15 秒截止時間
    state.deviationDeadline = Date.now() + 15000;

    if (document.visibilityState === 'hidden') {
        // 仍在背景：繼續 15 秒計時
        state.hiddenTimerObj = setTimeout(deviationFired, 15000);
    } else {
        // 在頁面上（前景倒數歸零）：重設 15 秒倒數
        startCognitiveBuffer(15);
    }
}

export function endCognitiveBuffer(safe) {
    clearInterval(state.bufferTimerObj);
    state.bufferTimerObj = null;
    clearTimeout(state.hiddenTimerObj);
    state.hiddenTimerObj = null;
    state.deviationDeadline = null;

    if (safe) {
        switchView('view-focus');
        document.body.classList.remove('mode-danger');
        document.body.classList.add('mode-flow');
    }
}
