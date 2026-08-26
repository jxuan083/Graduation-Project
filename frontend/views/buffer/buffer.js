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
import { vibrate } from '../../core/haptics.js?v=60';
import { getLockState } from '../../core/lockstate.js';

const GRACE_MS_BY_DIFFICULTY = { L: 30000, M: 20000, H: 10000 };
const getGraceMs = () => GRACE_MS_BY_DIFFICULTY[state.currentDifficulty] ?? 20000;

// 判定「這段離開是不是在 App 內關螢幕（鎖定）造成」的時間窗。
// iOS 回報鎖定（protectedDataWillBecomeUnavailable）最多延遲約 10 秒，給 12 秒緩衝；
// Android 的 SCREEN_OFF 可能比 visibilitychange 略早，給 3 秒前置容忍。
const LOCK_ATTRIBUTION_WINDOW_MS = 12000;
const LOCK_PRE_TOLERANCE_MS = 3000;

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
        const hiddenAt = state.hiddenAt;
        state.hiddenAt = null;

        // 沒有進行中的截止時間（理論上不會發生於回來時），保險起見直接回 focus
        if (!state.deviationDeadline) {
            endCognitiveBuffer(true);
            return;
        }

        // 需要問原生「這段離開是不是鎖定造成的」，屬非同步，交給 resolveVisibleReturn。
        resolveVisibleReturn(hiddenAt);
    } else {
        // 用戶離開：若尚未起算，現在起算 15 秒截止時間
        state.hiddenAt = Date.now();
        if (!state.deviationDeadline) {
            state.deviationDeadline = Date.now() + getGraceMs();
        }
        // 停掉前景倒數（背景不依賴計時器，回來時再補算）
        clearInterval(state.bufferTimerObj);
        state.bufferTimerObj = null;
        clearTimeout(state.hiddenTimerObj);
        state.hiddenTimerObj = null;

        sendAction('VISIBILITY_CHANGE', { state: 'hidden' });
    }
}

// 回到前景時，依原生鎖定訊號決定這段「離開」怎麼算：
//   情境 1：離開是「在 App 內按關螢幕鍵（鎖定）」造成 → 整段豁免，不計分心、不跳警告。
//   情境 2：先切別的 app、之後才鎖定 → 只計到鎖定當下為止（鎖定前才算真正離開）。
//   情境 3：全程未鎖定（切 app）或無原生訊號 → 沿用原本行為（補算 + 顯示倒數）。
async function resolveVisibleReturn(hiddenAt) {
    let lock = null;
    try { lock = await getLockState(); } catch (_) { lock = null; }

    // 等待原生回應期間可能又被切走；若已不在前景或本輪已結束，就不處理。
    if (document.visibilityState !== 'visible' || !state.deviationDeadline) return;

    if (lock && hiddenAt) {
        const lockedAt = lock.lastLockedAt;
        const attributedToScreenOff = lockedAt
            && lockedAt >= hiddenAt - LOCK_PRE_TOLERANCE_MS
            && lockedAt <= hiddenAt + LOCK_ATTRIBUTION_WINDOW_MS;

        if (attributedToScreenOff) {
            // 情境 1：在 App 內關螢幕 → 豁免，靜默回 focus，不補算、不跳警告。
            endCognitiveBuffer(true);
            sendAction('VISIBILITY_CHANGE', { state: 'visible' });
            return;
        }

        if (lockedAt && lockedAt > hiddenAt + LOCK_ATTRIBUTION_WINDOW_MS) {
            // 情境 2：先離開、後鎖定 → 只補算到鎖定當下，鎖定後不再計。
            reconcileDeviations(lockedAt);
            endCognitiveBuffer(true);
            sendAction('VISIBILITY_CHANGE', { state: 'visible' });
            return;
        }
    }

    // 情境 3：沿用原本行為。
    reconcileDeviations();
    startCognitiveBuffer();
    sendAction('VISIBILITY_CHANGE', { state: 'visible' });
}

// 依目前時間與 deviationDeadline 補算應記的分心次數，並把截止時間往後推。
// effectiveNow 可指定「以哪個時間點為準」（情境 2 用鎖定時間），預設為現在。
// 回傳這次補算的次數（0 表示還在本輪 grace 內）。
function reconcileDeviations(effectiveNow) {
    if (!state.deviationDeadline) return 0;
    const now = effectiveNow || Date.now();
    if (now < state.deviationDeadline) return 0;

    const overdue = now - state.deviationDeadline;
    const count = Math.floor(overdue / getGraceMs()) + 1;
    logDeviation(count);
    state.deviationDeadline += count * getGraceMs(); // 推進後必定 > now
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
        state.deviationDeadline = Date.now() + getGraceMs();
    }

    switchView('view-buffer', { replace: true });
    document.body.classList.remove('mode-flow');
    document.body.classList.add('mode-danger');

    renderRemaining();
    vibrate(200);

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
        switchView('view-focus', { replace: true });
        document.body.classList.remove('mode-danger');
        document.body.classList.add('mode-flow');
    }
}
