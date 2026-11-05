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
import { vibrate } from '../../core/haptics.js?v=83';
import { getLockState } from '../../core/lockstate.js';
import { setGraceCountdown, phoneOpenActivity, travelGraceActivity, studyBreakActivity } from '../../core/liveActivity.js';
import { phoneOpenActive, phoneOpenUntilMs, toLocalMs } from '../../core/phoneOpen.js';
import { breakWindow, breakOverlapMs } from '../../core/study.js';
import { syncAwayReport } from '../../core/awayReport.js';
import { movingMsFromSummary, deviationsDue } from '../../core/travel.js';

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
            const payload = { count: state.pendingDeviation };
            if (state.pendingDeviationAt) payload.at_ms = state.pendingDeviationAt;
            sendAction('LOG_DEVIATION', payload);
            state.pendingDeviation = 0;
            state.pendingDeviationAt = 0;
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

// 專心上課的老師：可以自由用手機、不計分（開會的主持人照舊）
const isClassTeacher = () => state.currentContext === 'class' && !!state.amIHost;

// 讀書會番茄鐘：聚會開始時間換成手機時間（不是讀書會或還沒開始 → 0）
const studyStartMs = () => (state.currentContext === 'study' ? toLocalMs(state.activeStartedMs) : 0);
const studyWindow = (now = Date.now()) => (studyStartMs() ? breakWindow(studyStartMs(), now) : null);

function syncGraceCountdown() {
    if (document.visibilityState !== 'visible') return;
    if (isClassTeacher()) {   // 老師離開 App 不倒數、不回報
        setGraceCountdown(false, getGraceMs());
        syncAwayReport(false);
        return;
    }
    const inSession = state.currentPhase === 'ACTIVE' && !state.photoModeActive;
    // 主持人開放使用手機中：跳出去顯示開放狀態（限時的倒數到結束），不是寬限倒數
    if (inSession && phoneOpenActive()) {
        setGraceCountdown(true, getGraceMs(), phoneOpenActivity(state.phoneOpen, state.currentContext));
        syncAwayReport(false);
        return;
    }
    const sw = inSession ? studyWindow() : null;
    if (sw && sw.onBreak) {   // 讀書會番茄鐘休息中：跳出去倒數到休息結束，不是寬限倒數
        setGraceCountdown(true, getGraceMs(), studyBreakActivity(sw.breakEnd));
        syncAwayReport(false);
        return;
    }
    const armed = inSession
        && !(state.exemptUntil > Date.now())      // 暫離中跳出去不算分心，顯示的是暫離倒數
        && !(state.orderTripUntil > Date.now());  // 帶出 App 點餐中，顯示的是「點餐中」
    const travelling = state.currentContext === 'outdoor';
    setGraceCountdown(armed, getGraceMs(), travelling ? travelGraceActivity() : null);
    // 跑出去到聚會結束都沒回來 → 0 分（iOS 才有；暫離、點餐、開放中有各自的超時規則；
    // 旅行不適用：移動中用手機不算分心，但後端確認不了一直沒回來的人是不是在移動）
    syncAwayReport(armed && !travelling);
}

function handleVisibilityChange() {
    if (state.currentPhase !== 'ACTIVE') return;
    if (state.photoModeActive) return;
    if (isClassTeacher()) {
        // 老師不計分：只回報在不在 App（給學生名單等用），不起算分心
        state.deviationDeadline = null;
        state.hiddenAt = null;
        if (document.visibilityState === 'visible') reportVisible();
        else sendAction('VISIBILITY_CHANGE', { state: 'hidden' });
        return;
    }

    if (document.visibilityState === 'visible') {
        const hiddenAt = state.hiddenAt;
        state.hiddenAt = null;
        // 暫離窗口、帶出 App 點餐、主持人開放使用手機的時間內回來：不算分心、不跳警告，直接回聚會畫面。
        // （開放中回來不會結束開放；「直到結束」的開放若在離開期間已結束，由後端在收到「回到 App」時補算。）
        const sw = studyWindow();
        const backWithinExemption = Math.max(state.exemptUntil || 0, state.orderTripUntil || 0, phoneOpenUntilMs()) > Date.now()
            || state.deviationDeadline === Infinity    // 離開時在「直到結束」的開放中：補算交給後端
            || !!(sw && sw.onBreak && hiddenAt && hiddenAt >= sw.breakStart);   // 讀書會：同一次休息裡離開又回來
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
            // 主持人開放「直到結束」中離開 → 無限遠（不在前端算，回來時由後端依結束時間補算）
            state.deviationDeadline = Math.max(Date.now(), state.exemptUntil || 0, state.orderTripUntil || 0, phoneOpenUntilMs()) + getGraceMs();
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

    // 旅行：離開期間在走路、跑步、騎車、搭車的時間不算分心（iPhone 本來就在背景記錄動作），
    // 把這段時間從起算點往後推，只算停下來的時間。網頁版或沒給「動作與健身」權限 → 照一般規則。
    if (state.currentContext === 'outdoor' && hiddenAt) {
        const movingMs = await movingMsBetween(hiddenAt, Date.now());
        if (document.visibilityState !== 'visible' || !state.deviationDeadline) return;
        if (movingMs > 0) state.deviationDeadline += movingMs;
    }

    // 讀書會：離開期間碰到番茄鐘休息，那段不算分心（同旅行扣掉移動時間的做法）
    const studyStart = studyStartMs();
    if (studyStart && hiddenAt) state.deviationDeadline += breakOverlapMs(studyStart, hiddenAt, Date.now());

    // 情境 2：切去別的 app（之後有沒有鎖螢幕都一樣）→ 補算到現在 + 顯示倒數。
    reconcileDeviations();
    const swNow = studyWindow();
    if (swNow && swNow.onBreak) {   // 回來時正在休息：不用跳警告頁
        endCognitiveBuffer(true);
        reportVisible();
        return;
    }
    startCognitiveBuffer();
    reportVisible();
}

// 一段時間裡「在移動」的毫秒數（走路、跑步、騎車、搭車）。查不到就回 0（照一般規則算）。
async function movingMsBetween(fromMs, toMs) {
    const p = window.Capacitor?.Plugins?.LockState;
    if (!p || typeof p.queryMovement !== 'function' || !(toMs > fromMs)) return 0;
    try {
        const r = await Promise.race([
            p.queryMovement({ fromMs, toMs }),
            new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        return movingMsFromSummary(r, fromMs, toMs);
    } catch (_) {
        return 0;
    }
}

// 依目前時間與 deviationDeadline 補算應記的分心次數，並把截止時間往後推。
// 回傳這次補算的次數（0 表示還在本輪 grace 內）。
function reconcileDeviations() {
    if (!state.deviationDeadline) return 0;
    const now = Date.now();
    if (now < state.deviationDeadline) return 0;

    const count = deviationsDue(state.deviationDeadline, now, getGraceMs());
    // 這批分心第一次發生在截止時間那一刻（不是現在回報的時間），換成伺服器時間一起送（約會的「誰先拿起手機」）
    logDeviation(count, state.deviationDeadline - (Number(state.serverClockOffset) || 0));
    state.deviationDeadline += count * getGraceMs(); // 推進後必定 > now
    return count;
}

function logDeviation(count, atServerMs = 0) {
    if (count <= 0) return;
    const payload = { count };
    if (atServerMs > 0) payload.at_ms = Math.round(atServerMs);
    if (!sendAction('LOG_DEVIATION', payload)) {
        // WS 斷線：暫存，重連後補送，並嘗試自動重連（第一次發生的時間取最早的）
        state.pendingDeviation = (state.pendingDeviation || 0) + count;
        if (payload.at_ms && (!state.pendingDeviationAt || payload.at_ms < state.pendingDeviationAt)) state.pendingDeviationAt = payload.at_ms;
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
