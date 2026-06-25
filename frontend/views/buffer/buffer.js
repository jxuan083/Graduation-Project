// views/buffer/buffer.js — 分心倒數提醒
//
// 計時模型：以「絕對時間戳 deviationDeadline」為唯一基準。
//   - 離開頁面 → 起算 15 秒截止時間（若尚未起算）
//   - 截止時間一到 → 分心 +1，截止時間往後推 15 秒
// 背景分頁的 setTimeout/setInterval 會被瀏覽器凍結或限流，因此「不」依賴
// 背景計時器累計分心；而是在使用者「回到頁面」時，依離開總時長一次補算
// 應記的分心次數（reconcileDeviations）。前景（頁面可見）時則用 setInterval
// 即時倒數，兩者都以同一個 deviationDeadline 為準，互不衝突。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { events } from '../../core/events.js';
import { reconnectSilent } from '../../core/session.js';

const GRACE_MS = 15000; // 每 15 秒未回到頁面記一次分心

export function init() {
    register('view-buffer', { element: document.getElementById('view-buffer') });

    // 「我回來專心了」按鈕 — 清除計時，回 focus，不再額外計分心
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
        state.hiddenAt = null;

        // 沒有進行中的截止時間（理論上不會發生於回來時），保險起見直接回 focus
        if (!state.deviationDeadline) {
            endCognitiveBuffer(true);
            return;
        }

        // 依離開總時長一次補算所有應記的分心
        reconcileDeviations();

        // 補算後 deviationDeadline 一定 > now，顯示本輪剩餘倒數
        startCognitiveBuffer();
        sendAction('VISIBILITY_CHANGE', { state: 'visible' });
    } else {
        // 用戶離開：若尚未起算，現在起算 15 秒截止時間
        state.hiddenAt = Date.now();
        if (!state.deviationDeadline) {
            state.deviationDeadline = Date.now() + GRACE_MS;
        }
        // 停掉前景倒數（背景不依賴計時器，回來時再補算）
        clearInterval(state.bufferTimerObj);
        state.bufferTimerObj = null;
        clearTimeout(state.hiddenTimerObj);
        state.hiddenTimerObj = null;

        sendAction('VISIBILITY_CHANGE', { state: 'hidden' });
    }
}

// 依目前時間與 deviationDeadline 補算應記的分心次數，並把截止時間往後推。
// 回傳這次補算的次數（0 表示還在本輪 15 秒內）。
function reconcileDeviations() {
    if (!state.deviationDeadline) return 0;
    const now = Date.now();
    if (now < state.deviationDeadline) return 0;

    const overdue = now - state.deviationDeadline;
    const count = Math.floor(overdue / GRACE_MS) + 1;
    logDeviation(count);
    state.deviationDeadline += count * GRACE_MS; // 推進後必定 > now
    return count;
}

function logDeviation(count) {
    if (count <= 0) return;
    if (!sendAction('LOG_DEVIATION', { count })) {
        // WS 斷線：暫存，重連後補送，並嘗試自動重連
        state.pendingDeviation = (state.pendingDeviation || 0) + count;
        reconnectSilent();
    }
}

// 前景倒數：顯示 buffer 畫面並每秒依 deviationDeadline 重算剩餘秒數。
// 倒數歸零（使用者停在警告頁卻不點按鈕）時，記一次分心並進入下一輪。
export function startCognitiveBuffer() {
    clearInterval(state.bufferTimerObj);
    state.bufferTimerObj = null;

    if (!state.deviationDeadline) {
        state.deviationDeadline = Date.now() + GRACE_MS;
    }

    switchView('view-buffer');
    document.body.classList.remove('mode-flow');
    document.body.classList.add('mode-danger');

    renderRemaining();
    if (navigator.vibrate) navigator.vibrate(200);

    state.bufferTimerObj = setInterval(() => {
        if (Date.now() >= state.deviationDeadline) {
            // 倒數歸零：補算（至少 +1）並進入下一輪，繼續顯示倒數
            reconcileDeviations();
        }
        renderRemaining();
    }, 1000);
}

function renderRemaining() {
    const remainingMs = Math.max(state.deviationDeadline - Date.now(), 0);
    state.bufferSecondsLeft = Math.ceil(remainingMs / 1000);
    const el = document.getElementById('buffer-timer');
    if (el) el.innerText = state.bufferSecondsLeft;
}

export function endCognitiveBuffer(safe) {
    clearInterval(state.bufferTimerObj);
    state.bufferTimerObj = null;
    clearTimeout(state.hiddenTimerObj);
    state.hiddenTimerObj = null;
    state.deviationDeadline = null;
    state.hiddenAt = null;

    if (safe) {
        switchView('view-focus');
        document.body.classList.remove('mode-danger');
        document.body.classList.add('mode-flow');
    }
}
