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
import { vibrate } from '../../core/haptics.js?v=78';
import { getLockState } from '../../core/lockstate.js';
import { setGraceCountdown } from '../../core/liveActivity.js';

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

    // 靈動島的寬限倒數：在 App 裡時每秒同步「現在跳出去會不會開始算分心」給原生，
    // 跳出 App 那一刻原生就照這個決定要不要開始倒數（倒數秒數 = 本場的寬限時間）。
    setInterval(syncGraceCountdown, 1000);

    // WS 重連後補送暫存的分心次數
    events.on('ws:open', () => {
        if (state.currentPhase !== 'ACTIVE') return;
        if (state.pendingDeviation > 0) {
            sendAction('LOG_DEVIATION', { count: state.pendingDeviation });
            state.pendingDeviation = 0;
        }
        // 從背景回來時 WS 多半已斷，當下那次「回到 App」的通知送不出去；重連後補報，
        // 否則後端會以為暫離一直沒回來（之後被當成超時、甚至自動離開）。
        sendAction('VISIBILITY_CHANGE', { state: document.visibilityState === 'visible' ? 'visible' : 'hidden' });
    });
}

// 暫離延長後：還在外面的話，分心的起算點跟著往後移到新的到期時間。
export function pushDeviationDeadlineToExemptEnd() {
    if (state.deviationDeadline && state.exemptUntil > Date.now()) {
        state.deviationDeadline = state.exemptUntil + getGraceMs();
    }
}

// 告訴後端「我回到 App 了」。從背景回來時 WS 常常已斷：送不出去就重連，
// 連上後 ws:open 會補報（沒補報的話，後端會以為暫離一直沒回來）。
function reportVisible() {
    if (!sendAction('VISIBILITY_CHANGE', { state: 'visible' })) reconnectSilent();
}

function syncGraceCountdown() {
    if (document.visibilityState !== 'visible') return;
    const armed = state.currentPhase === 'ACTIVE'
        && !state.photoModeActive
        && !(state.exemptUntil > Date.now())      // 暫離中跳出去不算分心，顯示的是暫離倒數
        && !(state.orderTripUntil > Date.now());  // 帶出 App 點餐中，顯示的是「點餐中」
    setGraceCountdown(armed, getGraceMs());
}

function handleVisibilityChange() {
    if (state.currentPhase !== 'ACTIVE') return;
    if (state.photoModeActive) return;

    if (document.visibilityState === 'visible') {
        const hiddenAt = state.hiddenAt;
        state.hiddenAt = null;
        // 暫離窗口或帶出 App 點餐的時間內回來：不算分心、不跳警告，直接回聚會畫面。
        const backWithinExemption = Math.max(state.exemptUntil || 0, state.orderTripUntil || 0) > Date.now();
        state.exemptUntil = 0;      // 回到 App 專心 → 這次暫離結束（後端也是這樣算）
        state.orderTripUntil = 0;   // 帶出點餐也一樣，回來就結束
        if (backWithinExemption) {
            endCognitiveBuffer(true);
            reportVisible();
            return;
        }

        // 沒有進行中的截止時間（理論上不會發生於回來時），保險起見直接回 focus
        if (!state.deviationDeadline) {
            endCognitiveBuffer(true);
            return;
        }

        // 需要問原生「這段離開是不是鎖定造成的」，屬非同步，交給 resolveVisibleReturn。
        resolveVisibleReturn(hiddenAt);
    } else {
        // 用戶離開：若尚未起算，現在起算截止時間。暫離窗口內離開 → 從窗口到期才開始算，
        // 這樣超時回來只會補算「超過窗口」的部分，不會把整段暫離都算成分心。
        state.hiddenAt = Date.now();
        if (!state.deviationDeadline) {
            state.deviationDeadline = Math.max(Date.now(), state.exemptUntil || 0, state.orderTripUntil || 0) + getGraceMs();
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
//   情境 2：先切去別的 app → 不管之後有沒有鎖螢幕，都照算到回到 App 為止。
//     （定錨的意思是黏在 App 上：跳出去就要回來，回到 App 後再關螢幕才不算分心。）
//   iOS 的鎖定訊號會晚約 10 秒才到，所以「離開後 12 秒內收到鎖定」都當成情境 1；
//   切出去不到 2 秒就鎖螢幕的極短情況會被當成情境 1，這是系統訊號延遲造成的限制。
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
            reportVisible();
            return;
        }
    }

    // 情境 2：切去別的 app（之後有沒有鎖螢幕都一樣）→ 補算到現在 + 顯示倒數。
    reconcileDeviations();
    startCognitiveBuffer();
    reportVisible();
}

// 依目前時間與 deviationDeadline 補算應記的分心次數，並把截止時間往後推。
// 回傳這次補算的次數（0 表示還在本輪 grace 內）。
function reconcileDeviations() {
    if (!state.deviationDeadline) return 0;
    const now = Date.now();
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
