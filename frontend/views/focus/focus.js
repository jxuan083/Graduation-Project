// views/focus/focus.js
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { apiFetch } from '../../core/api.js';
import { events } from '../../core/events.js';
import { openQaSourcePicker } from '../qa-source/qa-source.js';
import { hostStartTabooGame } from '../../features/taboo/controller.js';
import { startPhotoMode, endPhotoMode, uploadMeetingPhoto, autoSaveCapturedPhoto } from '../../features/photos/controller.js';
import { openInviteModal } from '../invite-modal/invite-modal.js';
import { showToast } from '../../utils/toast.js';
import { t } from '../../core/i18n.js';
import { isImeComposing } from '../../utils/ime.js';
import { reconnectSilent } from '../../core/session.js';
import { startBreakCountdown, extendBreakCountdown, endCountdown, startOrderActivity } from '../../core/liveActivity.js';
import { orderingPlugin, orderingAvailable, orderTripsLeft, orderingLabels, requestOrderTrip } from '../../core/ordering.js';
import { startWeather, stopWeather, resetWeather } from '../../core/meetingWeather.js';
import { EXEMPT_BUDGET_BY_CONTEXT, ORDER_TRIP_LIMIT, PHONE_OPEN_MAX_MINUTES, REST_CONTEXTS, REST_MAX_MINUTES } from '../../core/config.js';
import { scheduleIntentEnd, cancelIntentNotifications, initIntentActions, scheduleOrderReminders, cancelOrderReminders, schedulePhoneOpenEnd, cancelPhoneOpenNotifications } from '../../core/localNotify.js';
import { phoneOpenModes, phoneOpenActive, phoneOpenTimed, phoneOpenEndedMs, phoneOpenIsRest, localizePhoneOpen, toLocalMs } from '../../core/phoneOpen.js';
import { myRejoinsLeft, presentMemberEntries, requestExtendIntent, requestLeaveSession } from '../../core/leave.js';
import { pushDeviationDeadlineToExemptEnd } from '../buffer/buffer.js?v=82';

export function init() {
    register('view-focus', {
        element: document.getElementById('view-focus'),
        onShow: () => { refreshFocusMascot(); startWeather(); },
        onHide: stopWeather,
    });

    // 每場聚會開始時把天氣清成晴天、清掉上一場的分心紀錄與暫離狀態
    events.on('session:joined', () => {
        resetWeather();
        endIntentCountdown();
        _intentRemaining = null;   // 等第一個 ROOM_UPDATE 依後端資料算出這一場的剩餘次數
        const devEl = document.getElementById('deviation-count');
        if (devEl) devEl.innerText = '0';
    });

    // 折疊成員清單
    const btnFocusToggle = document.getElementById('btn-focus-members-toggle');
    if (btnFocusToggle) btnFocusToggle.onclick = toggleFocusMembersPanel;

    // 遊戲區 / 拍照：點開底部選單
    const gameZoneBtn = document.getElementById('btn-game-zone');
    if (gameZoneBtn) gameZoneBtn.onclick = () => openSheet('game-sheet');
    const photoZoneBtn = document.getElementById('btn-photo-zone');
    if (photoZoneBtn) photoZoneBtn.onclick = () => openSheet('photo-sheet');
    // 底部選單：取消 / 點背景關閉
    bindSheet('game-sheet', 'btn-game-sheet-cancel');
    bindSheet('photo-sheet', 'btn-photo-sheet-cancel');

    // 房主發起問答（選項在遊戲選單內，點了先關選單）
    const qaBtn = document.getElementById('btn-mode-qa');
    if (qaBtn) qaBtn.addEventListener('click', () => { closeSheets(); openQaSourcePicker(); });

    // 房主發起關鍵字遊戲
    const tabooBtn = document.getElementById('btn-mode-taboo');
    if (tabooBtn) tabooBtn.addEventListener('click', () => { closeSheets(); hostStartTabooGame(); });

    // 參與者拍照 / 上傳（手機→原生相機；電腦→網頁鏡頭；點了先關選單）
    document.getElementById('btn-meeting-camera').onclick = () => { closeSheets(); handleMeetingCameraClick(); };
    document.getElementById('btn-meeting-album').onclick = () => { closeSheets(); handleMeetingPhotoClick('meeting-album-input'); };
    document.getElementById('meeting-camera-input').addEventListener('change', handleMeetingPhotoChange);
    document.getElementById('meeting-album-input').addEventListener('change', handleMeetingPhotoChange);
    // 電腦網頁鏡頭 modal 的按鈕
    const camShoot = document.getElementById('mc-cam-shoot');
    const camCancel = document.getElementById('mc-cam-cancel');
    if (camShoot) camShoot.onclick = captureMeetingPhoto;
    if (camCancel) camCancel.onclick = closeMeetingCameraModal;

    // 即時語音轉文字：揭示 / 收合錄音面板（front-preview 兩段式）
    const recordReveal = document.getElementById('btn-focus-record-reveal');
    const recordPanel = document.getElementById('focus-record-panel');
    const recordClose = document.getElementById('btn-focus-record-close');
    if (recordReveal && recordPanel) {
        recordReveal.onclick = () => {
            recordPanel.style.display = (recordPanel.style.display === 'none' || !recordPanel.style.display) ? 'block' : 'none';
        };
    }
    if (recordClose && recordPanel) {
        recordClose.onclick = () => { recordPanel.style.display = 'none'; };
    }

    // 開始 / 停止錄音
    const liveBtn = document.getElementById('btn-live-transcript-toggle');
    if (liveBtn) liveBtn.onclick = toggleLiveTranscript;
    events.on('session:cleanup', () => {
        if (state.liveTranscript.active) stopLiveTranscript('已停止即時轉文字');
        closeMeetingCameraModal();
        stopWeather();
        resetWeather();
        endIntentCountdown();
        _intentRemaining = null;
        state.meetingGroupPetFace = '';
        state.meetingGroupPetName = '';
        state.meetingGroupPetLevel = 1;
    });

    // 邀請朋友
    const btnFocusInvite = document.getElementById('btn-focus-invite');
    if (btnFocusInvite) btnFocusInvite.onclick = openInviteModal;

    // 掃碼點餐
    initOrdering();

    // 主持人開放使用手機（開會、上課）
    initPhoneOpen();

    // 需要用手機：宣告意圖
    const btnIntent = document.getElementById('btn-declare-intent');
    if (btnIntent) btnIntent.onclick = handleDeclareIntent;
    // 意圖輸入彈窗的按鈕
    const intentModal = document.getElementById('intent-modal');
    const intentClose = document.getElementById('btn-intent-modal-close');
    const intentCancel = document.getElementById('btn-intent-cancel');
    const intentConfirm = document.getElementById('btn-intent-confirm');
    const intentInput = document.getElementById('intent-reason-input');
    if (intentClose) intentClose.onclick = closeIntentModal;
    if (intentCancel) intentCancel.onclick = closeIntentModal;
    if (intentConfirm) intentConfirm.onclick = confirmIntentModal;
    if (intentModal) intentModal.addEventListener('click', (e) => { if (e.target === intentModal) closeIntentModal(); });
    if (intentInput) intentInput.addEventListener('keydown', (e) => {
        if (isImeComposing(e)) return;   // 這顆 Enter 是輸入法在選字，不是送出
        if (e.key === 'Enter') { e.preventDefault(); confirmIntentModal(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeIntentModal(); }
    });
    // 回到 App 專心時，豁免已由後端結束 → 按鈕還原，並提示這次暫離結束了
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') cancelOrderReminders();   // 回到 App：帶出點餐結束
        if (document.visibilityState === 'visible' && _intentEndMs > Date.now()) {
            endIntentCountdown();
            showToast(t('暫離結束，回到專心'), 'info');
        }
    });

    // 結束／離開聚會：主持人可結束整場或自己先離開；其他人只離開自己（其他人繼續）
    document.getElementById('btn-end-session').onclick = openLeaveSheet;
    bindSheet('leave-sheet', 'btn-leave-sheet-cancel');
    bindSheet('successor-sheet', 'btn-successor-sheet-cancel');
    document.getElementById('btn-leave-end-all').onclick = () => { closeSheets(); handleEndSession(); };
    document.getElementById('btn-leave-self').onclick = () => {
        // 開會：主持人先離開要自己選接手的人
        if (state.amIHost && state.currentContext === 'meeting') { openSuccessorSheet(); return; }
        leaveSelf();
    };

    // 「暫離時間到」通知上的兩個按鈕：延長一次／提前離開
    initIntentActions({
        extend: extendIntentFromNotification,
        leave: () => leaveSelf({ fromTimeout: true }),
    });
}

// ── 意圖暫離：宣告後換一段不算分心的窗口；回到 App 專心或時間到就還原 ──
// 按鈕四態：可用「需要用一下手機」／倒數「暫離中…」／用完(禁用)「暫離次數已用完」／
// 此情境不開放暫離(整顆隱藏)。
let _intentTimer = null;
let _intentEndMs = 0;
let _intentRemaining = null;   // null = 尚未知道（進聚會時依情境預算初始化）
let _intentReason = '';        // 這次暫離要做什麼（只有自己看得到，不上傳）

function handleDeclareIntent() {
    const btn = document.getElementById('btn-declare-intent');
    if (!btn || btn.style.display === 'none' || btn.disabled) return;
    if (_intentEndMs > Date.now()) { endIntentEarly(); return; }  // 暫離中再按一次 → 提前結束
    openIntentModal();
}

// 暫離中再按一次按鈕：提前結束這次暫離、回到專心。這次的暫離次數已經用掉，不會還回來。
function endIntentEarly() {
    // 後端把「回到 App 專心」當成暫離結束的訊號；人本來就在 App 裡，直接送同一個訊號。
    // 連線斷了就重連，連上後 buffer.js 會補報目前在 App 內。
    if (!sendAction('VISIBILITY_CHANGE', { state: 'visible' })) reconnectSilent();
    state.exemptUntil = 0;
    endIntentCountdown();
    showToast(t('暫離結束，回到專心'), 'info');
}

// ── 意圖輸入彈窗 ──
function openIntentModal() {
    const modal = document.getElementById('intent-modal');
    const input = document.getElementById('intent-reason-input');
    if (!modal) { sendAction('DECLARE_INTENT'); return; }  // 保底：沒有彈窗就直接宣告
    if (input) input.value = '';
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
    // 讓輸入框拿到焦點（延遲一拍避免動畫吃掉 focus）
    setTimeout(() => input?.focus(), 60);
}

function closeIntentModal() {
    const modal = document.getElementById('intent-modal');
    if (modal) modal.classList.add('hidden');
}

function confirmIntentModal() {
    const input = document.getElementById('intent-reason-input');
    _intentReason = (input?.value || '').trim().slice(0, 30);
    closeIntentModal();
    sendAction('DECLARE_INTENT');
}

// 依情境預算決定按鈕：預算=0 → 整顆隱藏；否則顯示，並初始化剩餘次數。
// refreshFocusMascot（進聚會 / 每次 room 更新）會呼叫，屆時已知 state.currentContext。
function updateIntentAvailability() {
    const btn = document.getElementById('btn-declare-intent');
    if (!btn) return;
    const budget = EXEMPT_BUDGET_BY_CONTEXT[state.currentContext] ?? 0;
    if (budget <= 0) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    // 剩餘次數 = 這個情境的額度 − 後端記的已用次數。每一場從頭算；重連、加回則會延續。
    // （先前是沿用模組裡的舊數字，上一場用掉的次數會被帶進下一場。）
    _intentRemaining = Math.max(0, budget - myExemptUsed());
    if (_intentEndMs <= Date.now()) renderIntentButton();
}

// 後端記在成員資料裡的「這一場已用掉幾次暫離」
function myExemptUsed() {
    return Number(state.roomMembers?.[state.userId]?.exempt_count_used || 0);
}

// INTENT_GRANTED／REJECTED 只會告訴自己剩幾次，不會重新廣播成員資料；
// 把本機那份成員資料跟著更新，之後畫面重畫時才不會算回舊數字。
function syncMyExemptUsed(remaining) {
    const me = state.roomMembers?.[state.userId];
    if (!me) return;
    const budget = EXEMPT_BUDGET_BY_CONTEXT[state.currentContext] ?? 0;
    me.exempt_count_used = Math.max(0, budget - remaining);
}

// 非倒數狀態下的按鈕外觀：用完 → 禁用；否則可用。
function renderIntentButton() {
    const btn = document.getElementById('btn-declare-intent');
    const label = document.getElementById('intent-btn-label');
    if (!btn || !label) return;
    btn.classList.remove('is-active');
    if (phoneOpenActive()) {
        // 主持人開放使用手機中／旅行休息中：大家都可以用，不用另外暫離（後端也會拒絕）
        btn.disabled = true;
        label.textContent = phoneOpenIsRest() ? t('休息中，不用暫離') : t('開放使用手機中，不用暫離');
    } else if (_intentRemaining !== null && _intentRemaining <= 0) {
        btn.disabled = true;
        label.textContent = t('暫離次數已用完');
    } else {
        btn.disabled = false;
        // 顯示剩餘次數：暫離結束後按鈕回到這個狀態時，看得出次數有被用掉（不是被重置）
        label.textContent = _intentRemaining === null
            ? t('需要用一下手機')
            : t('需要用一下手機 · 還可 {n} 次', { n: _intentRemaining });
    }
}

// 後端授予（wsHandlers 收到 INTENT_GRANTED 時呼叫）
export function applyIntentGranted(windowSec, remaining) {
    _intentRemaining = Math.max(0, Number(remaining) || 0);
    syncMyExemptUsed(_intentRemaining);
    _intentEndMs = Date.now() + Math.max(1, Number(windowSec) || 0) * 1000;
    state.exemptUntil = _intentEndMs;   // buffer.js 依此決定離開時從何時開始算分心
    startBreakCountdown(_intentEndMs);  // 靈動島／鎖定畫面倒數（iOS 即時動態）
    clearInterval(_intentTimer);
    renderIntentCountdown();
    _intentTimer = setInterval(renderIntentCountdown, 1000);
    // 排「時間到」本地通知（原生 app 才會生效；桌機/web 自動略過）。
    // 延長也要用掉一次暫離，所以已經沒有次數時，通知上不放「延長一次」。
    scheduleIntentEnd(Number(windowSec) || 0, { allowExtend: _intentRemaining > 0 });
}

// 後端拒絕：此情境不開放 → 隱藏；次數用完 → 禁用；其餘（冷卻中）→ toast。
export function applyIntentRejected(reason) {
    const r = reason || '';
    if (r.includes('不開放')) {
        const btn = document.getElementById('btn-declare-intent');
        if (btn) btn.style.display = 'none';
        return;
    }
    if (r.includes('用完')) {
        _intentRemaining = 0;
        syncMyExemptUsed(0);
        renderIntentButton();
        return;
    }
    try { showToast(r || t('現在無法暫離'), 'warn'); } catch (_) { /* noop */ }
}

function renderIntentCountdown() {
    const btn = document.getElementById('btn-declare-intent');
    const label = document.getElementById('intent-btn-label');
    if (!btn || !label) return;
    const leftMs = _intentEndMs - Date.now();
    if (leftMs <= 0) { endIntentCountdown(); return; }
    const s = Math.ceil(leftMs / 1000);
    const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    btn.classList.add('is-active');
    if (_intentReason) {
        const shortReason = _intentReason.length > 12 ? _intentReason.slice(0, 12) + '…' : _intentReason;
        label.textContent = t('暫離中 · {reason} · 剩 {time}', { reason: shortReason, time: mmss });
    } else {
        label.textContent = t('暫離中 · 剩 {time} · 再按一次結束', { time: mmss });
    }
}

function endIntentCountdown() {
    clearInterval(_intentTimer);
    _intentTimer = null;
    _intentEndMs = 0;
    _intentReason = '';
    cancelIntentNotifications();  // 回到 App / 時間到 → 清掉尚未觸發的到期通知
    // 人在 App 裡（回來了、提前結束、時間到）才收掉靈動島倒數；
    // 剛跳出 App 時計時器可能還會跑幾秒，那時時間到要留著倒數，讓它切成「超時」。
    if (document.visibilityState === 'visible') endCountdown();
    renderIntentButton();  // 顯示可用或（用完）禁用
}

// ── 主持人開放使用手機（開會、專心上課）──
// 主持人按下後，全場這段時間離開 App 都不算分心、算專心。上課可限時（不能提前結束）或「直到我結束」，
// 開會只有「直到我結束」。限時的結束時間事先知道 → 每個人的手機自己排通知與靈動島倒數；
// 「直到我結束」結束時還在外面的人收不到即時通知，回到 App 時由後端補算（PHONE_OPEN_OVERAGE）。
let _phoneOpenTimer = null;
let _phoneOpenEndNoticed = 0;   // 已經處理過「結束」的那次開放（key = 後端的開始時間），避免重複提示

const isClassContext = () => state.currentContext === 'class';
const hostWord = () => (isClassContext() ? t('老師') : t('主持人'));

function initPhoneOpen() {
    const btn = document.getElementById('btn-phone-open');
    if (btn) btn.onclick = handlePhoneOpenButton;
    const restBtn = document.getElementById('btn-rest');
    if (restBtn) restBtn.onclick = handleRestButton;
    const modal = document.getElementById('phone-open-modal');
    document.getElementById('btn-phone-open-close')?.addEventListener('click', closePhoneOpenModal);
    document.getElementById('btn-phone-open-confirm')?.addEventListener('click', () => confirmPhoneOpen('primary'));
    document.getElementById('btn-phone-open-secondary')?.addEventListener('click', () => confirmPhoneOpen('secondary'));
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closePhoneOpenModal(); });
    document.getElementById('phone-open-minutes')?.addEventListener('input', renderPhoneOpenModalButtons);
    // 快速選項與 −／+（不用叫出鍵盤；也保留直接輸入自訂分鐘數）
    document.querySelectorAll('#phone-open-minutes-row .phone-open-preset').forEach((btn) => {
        btn.addEventListener('click', () => setOpenMinutes(Number(btn.dataset.minutes)));
    });
    document.getElementById('btn-phone-open-minus')?.addEventListener('click', () => setOpenMinutes((readOpenMinutes() || 10) - 5));
    document.getElementById('btn-phone-open-plus')?.addEventListener('click', () => setOpenMinutes((readOpenMinutes() || 0) + 5));
    const reset = () => {
        clearInterval(_phoneOpenTimer);
        _phoneOpenTimer = null;
        _phoneOpenEndNoticed = 0;
        state.phoneOpen = null;
        state.restVotes = [];
        state.restEndVotes = [];
        cancelPhoneOpenNotifications();
        closePhoneOpenModal();
        renderPhoneOpenButton();
        renderRestButton();
        renderPhoneOpenAway();
    };
    events.on('session:joined', reset);
    events.on('session:cleanup', reset);
}

function handlePhoneOpenButton() {
    if (!state.amIHost || !phoneOpenModes().length) return;
    if (phoneOpenActive()) {
        if (phoneOpenTimed()) return;   // 限時開放不能提前結束
        if (!sendAction('CLOSE_PHONES')) { reconnectSilent(); showToast(t('連線中斷，請再按一次'), 'warn'); return; }
        showToast(t('已結束開放，記得提醒大家回到 App'), 'info');
        return;
    }
    openPhoneOpenModal();
}

function openPhoneOpenModal() {
    const modal = document.getElementById('phone-open-modal');
    if (!modal) return;
    const timedAllowed = phoneOpenModes().includes('timed');
    document.getElementById('phone-open-title').textContent = isClassContext() ? t('開放學生使用手機') : t('開放大家使用手機');
    document.getElementById('phone-open-hint').textContent = timedAllowed
        ? t('這段時間大家離開 App 都不算分心。限時開放不能提前結束；選「直到我結束」，結束時還在外面的人收不到通知，請口頭提醒。')
        : t('直到你按「結束開放」為止，大家離開 App 都不算分心。結束時還在外面的人收不到通知，請口頭提醒大家。');
    document.getElementById('phone-open-minutes-row').style.display = timedAllowed ? '' : 'none';
    renderPhoneOpenModalButtons();
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

function closePhoneOpenModal() {
    document.getElementById('phone-open-modal')?.classList.add('hidden');
}

function setOpenMinutes(n) {
    const input = document.getElementById('phone-open-minutes');
    if (!input) return;
    input.value = String(Math.min(PHONE_OPEN_MAX_MINUTES, Math.max(1, Math.round(n) || 1)));
    renderPhoneOpenModalButtons();
}

function readOpenMinutes() {
    const n = Math.round(Number(document.getElementById('phone-open-minutes')?.value));
    return Number.isFinite(n) && n >= 1 && n <= PHONE_OPEN_MAX_MINUTES ? n : 0;
}

// 上課：主按鈕「開放 N 分鐘」、次按鈕「直到我結束」；開會：主按鈕「開放」、次按鈕「取消」
function renderPhoneOpenModalButtons() {
    const primary = document.getElementById('btn-phone-open-confirm');
    const secondary = document.getElementById('btn-phone-open-secondary');
    if (!primary || !secondary) return;
    if (phoneOpenModes().includes('timed')) {
        const n = readOpenMinutes();
        // 快速選項：目前的分鐘數剛好是其中一個就標起來
        document.querySelectorAll('#phone-open-minutes-row .phone-open-preset').forEach((btn) => {
            btn.classList.toggle('is-active', Number(btn.dataset.minutes) === n);
        });
        primary.textContent = n ? t('開放 {n} 分鐘', { n }) : t('請輸入 1～{max} 分鐘', { max: PHONE_OPEN_MAX_MINUTES });
        primary.disabled = !n;
        secondary.textContent = t('直到我結束');
    } else {
        primary.textContent = t('開放');
        primary.disabled = false;
        secondary.textContent = t('取消');
    }
}

function confirmPhoneOpen(which) {
    const timedAllowed = phoneOpenModes().includes('timed');
    let minutes = 0;
    if (which === 'primary' && timedAllowed) {
        minutes = readOpenMinutes();
        if (!minutes) return;
    } else if (which === 'secondary' && !timedAllowed) {
        closePhoneOpenModal();   // 開會的次按鈕是「取消」
        return;
    }
    closePhoneOpenModal();
    if (!sendAction('OPEN_PHONES', minutes ? { minutes } : {})) {
        reconnectSilent();
        showToast(t('連線中斷，請再按一次'), 'warn');
    }
}

// 收到後端最新的開放狀態（ROOM_UPDATE）：提示開始／結束，排或取消限時的通知，更新畫面
export function applyPhoneOpen(serverPo) {
    const prev = state.phoneOpen;
    const po = localizePhoneOpen(serverPo);   // 時間點換成手機時間（wsHandlers 已先更新時差）
    state.phoneOpen = po;
    const sameOpen = prev && po && prev.key === po.key;
    if (po && phoneOpenActive() && !sameOpen && state.currentPhase === 'ACTIVE') {
        if (phoneOpenIsRest()) {
            showToast(t('休息時間開始，最多 {n} 分鐘，這段時間用手機不算分心', { n: REST_MAX_MINUTES }), 'info');
        } else if (state.amIHost) {
            showToast(t('已開放使用手機'), 'success');
        } else if (phoneOpenTimed()) {
            const mins = Math.round((Number(po.until_ms) - Number(po.since_ms)) / 60000);
            showToast(t('{who}開放使用手機 {n} 分鐘，這段時間不算分心', { who: hostWord(), n: mins }), 'info');
        } else {
            showToast(t('{who}開放使用手機了，這段時間不算分心', { who: hostWord() }), 'info');
        }
    }
    if (po && (phoneOpenTimed() || phoneOpenIsRest()) && phoneOpenActive()) {
        schedulePhoneOpenEnd(Number(po.until_ms), phoneOpenIsRest() ? 'rest' : (isClassContext() ? 'class' : 'meeting'));
    }
    if (prev && !phoneOpenActive() && sameOpen && prev.key !== _phoneOpenEndNoticed) {
        notePhoneOpenEnded();
    }
    if (!po || !phoneOpenActive()) cancelPhoneOpenNotifications();
    syncPhoneOpenTimer();
    renderPhoneOpenButton();
    renderRestButton();
    renderPhoneOpenAway();
    if (_intentEndMs <= Date.now()) renderIntentButton();
}

// 開放結束（主持人按結束，或限時到了）：人在 App 裡才看得到這個提示
function notePhoneOpenEnded() {
    _phoneOpenEndNoticed = Number(state.phoneOpen?.key || 0);
    if (state.currentPhase !== 'ACTIVE') return;
    if (phoneOpenIsRest()) { showToast(t('休息結束了，現在離開 App 會開始算分心'), 'info'); return; }
    if (state.amIHost) return;
    showToast(t('開放時間結束，現在離開 App 會開始算分心'), 'info');
}

// 回到 App 時後端補算：「直到結束」的開放在他離開期間就結束了
export function applyPhoneOpenOverage(count, endedMs) {
    const n = Number(count) || 0;
    if (n <= 0) return;
    const mins = Math.max(1, Math.round((Date.now() - (toLocalMs(endedMs) || Date.now())) / 60000));
    if (phoneOpenIsRest()) {
        showToast(t('休息在 {m} 分鐘前就結束了，補記分心 {n} 次', { m: mins, n }), 'warn');
        return;
    }
    showToast(t('{who}在 {m} 分鐘前就結束開放了，補記分心 {n} 次', { who: hostWord(), m: mins, n }), 'warn');
}

function syncPhoneOpenTimer() {
    const shouldTick = phoneOpenActive() || (phoneOpenEndedMs() && state.amIHost && isClassContext());
    if (shouldTick && !_phoneOpenTimer) {
        _phoneOpenTimer = setInterval(tickPhoneOpen, 1000);
    } else if (!shouldTick && _phoneOpenTimer) {
        clearInterval(_phoneOpenTimer);
        _phoneOpenTimer = null;
    }
}

function tickPhoneOpen() {
    // 限時開放到點：後端不會另外廣播，前端自己切換
    const po = state.phoneOpen;
    if (po && !phoneOpenActive() && po.key !== _phoneOpenEndNoticed) {
        notePhoneOpenEnded();
        cancelPhoneOpenNotifications();
        if (_intentEndMs <= Date.now()) renderIntentButton();
    }
    renderPhoneOpenButton();
    renderRestButton();
    renderPhoneOpenAway();
    syncPhoneOpenTimer();
}

const fmtMmss = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// 主持人：可按（開放／結束開放；限時中顯示剩餘時間、不能按）；其他人：開放中才顯示狀態
export function renderPhoneOpenButton() {
    const btn = document.getElementById('btn-phone-open');
    const label = document.getElementById('phone-open-label');
    if (!btn || !label) return;
    const modes = phoneOpenModes();
    const active = phoneOpenActive();
    if (!modes.length || state.currentPhase !== 'ACTIVE' || (!state.amIHost && !active)) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    btn.classList.toggle('is-active', active);
    const left = active && phoneOpenTimed() ? fmtMmss(Number(state.phoneOpen.until_ms) - Date.now()) : '';
    if (state.amIHost) {
        if (!active) {
            btn.disabled = false;
            label.textContent = isClassContext() ? t('開放學生使用手機') : t('開放大家使用手機');
        } else if (left) {
            btn.disabled = true;
            label.textContent = t('開放使用手機中 · 剩 {time}', { time: left });
        } else {
            btn.disabled = false;
            label.textContent = t('結束開放使用手機');
        }
    } else {
        btn.disabled = true;
        label.textContent = left
            ? t('{who}開放使用手機中 · 剩 {time}', { who: hostWord(), time: left })
            : t('{who}開放使用手機中', { who: hostWord() });
    }
}

// ── 旅行：投票休息 ──
// 在場一半以上（無條件進位，兩個人時一票就夠）按「休息一下」就開始，最長 30 分鐘；
// 休息中一半以上按「結束休息」就結束。再按一次可以取消自己的票。
const restAvailable = () => REST_CONTEXTS.includes(state.currentContext);

function restNeeded() {
    return Math.max(1, Math.ceil(presentMemberEntries().length / 2));
}

function handleRestButton() {
    if (!restAvailable() || state.currentPhase !== 'ACTIVE') return;
    const action = phoneOpenActive() && phoneOpenIsRest() ? 'REST_END_VOTE' : 'REST_VOTE';
    if (!sendAction(action)) {
        reconnectSilent();
        showToast(t('連線中斷，請再按一次'), 'warn');
    }
}

// 收到最新的投票：有人新按了「休息一下」就提醒其他人（自己按的不提醒）
export function applyRestVotes(votes, endVotes) {
    const prev = new Set(state.restVotes || []);
    state.restVotes = Array.isArray(votes) ? votes : [];
    state.restEndVotes = Array.isArray(endVotes) ? endVotes : [];
    if (restAvailable() && state.currentPhase === 'ACTIVE' && !phoneOpenActive()) {
        const newcomer = state.restVotes.find(uid => !prev.has(uid) && uid !== state.userId);
        if (newcomer && state.restVotes.length < restNeeded()) {
            const name = state.roomMembers?.[newcomer]?.nickname || t('有成員');
            showToast(t('{name} 想休息一下，你也想的話按「休息一下」', { name }), 'info');
        }
    }
    renderRestButton();
}

export function renderRestButton() {
    const btn = document.getElementById('btn-rest');
    const label = document.getElementById('rest-btn-label');
    if (!btn || !label) return;
    if (!restAvailable() || state.currentPhase !== 'ACTIVE') {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    btn.disabled = false;
    const resting = phoneOpenActive() && phoneOpenIsRest();
    btn.classList.toggle('is-active', resting);
    const votes = resting ? (state.restEndVotes || []) : (state.restVotes || []);
    const mine = votes.includes(state.userId);
    const left = Math.max(0, restNeeded() - votes.length);
    if (resting) {
        label.textContent = mine
            ? t('想結束休息 · 還差 {n} 人（再按取消）', { n: left })
            : votes.length
                ? t('休息中 · {v} 人想結束 · 按這裡結束休息', { v: votes.length })
                : t('休息中 · 按這裡結束休息');
    } else {
        label.textContent = mine
            ? t('想休息了 · 還差 {n} 人（再按取消）', { n: left })
            : votes.length
                ? t('{v} 人想休息 · 還差 {n} 人', { v: votes.length, n: left })
                : t('休息一下');
    }
}

// 老師限時開放結束後 10 分鐘內：列出還沒回到 App 的學生（在 App 內關螢幕的人也會在名單上）
const AWAY_LIST_MS = 10 * 60 * 1000;
export function renderPhoneOpenAway() {
    const box = document.getElementById('phone-open-away');
    const names = document.getElementById('phone-open-away-names');
    if (!box || !names) return;
    const ended = phoneOpenEndedMs();
    const show = state.amIHost && isClassContext() && state.currentPhase === 'ACTIVE'
        && ended && !phoneOpenActive() && Date.now() - ended < AWAY_LIST_MS;
    const away = show ? Object.entries(state.roomMembers || {})
        .filter(([uid, m]) => uid !== state.userId && m && (m.state === 'hidden' || m.state === 'DISCONNECTED'))
        .map(([, m]) => m.nickname || t('成員')) : [];
    box.style.display = away.length ? '' : 'none';
    names.textContent = away.join('、');
}

// 聚會中吉祥物：綁定群組且該群組有寵物 → 顯示寵物臉；否則退回 Lottie 動畫球
export function refreshFocusMascot() {
    // 依情境切換場景外觀（每個情境一張卡通插畫；還不知道情境時=預設戶外舞台）
    const sceneCard = document.querySelector('#view-focus .pa-scene-card');
    if (sceneCard) {
        const SCENE_BY_CONTEXT = { date: 'scene-date', study: 'scene-study', meal: 'scene-meal', meeting: 'scene-meeting', class: 'scene-class', family: 'scene-family', social: 'scene-social', general: 'scene-general', outdoor: 'scene-outdoor' };
        // 先清掉所有情境場景 class（否則切換情境時舊場景會殘留、疊在新場景上）
        Object.values(SCENE_BY_CONTEXT).forEach(c => sceneCard.classList.remove(c));
        const sc = SCENE_BY_CONTEXT[state.currentContext];
        if (sc) sceneCard.classList.add(sc);
        // 有對應的卡通場景圖 → 場景卡改用圖片當背景、寵物坐到圖上的座位（見 redesign.css「情境場景：卡通插畫」）
        sceneCard.classList.toggle('has-scene', !!sc);
        // 家庭、自習、上課：寵物坐在桌子後面（下半身被桌緣切掉，不上下晃）
        sceneCard.classList.toggle('pet-behind', ['family', 'study', 'class'].includes(state.currentContext));
    }

    const orb = document.getElementById('lottie-orb');
    const petImg = document.getElementById('focus-pet-face');
    const identity = document.getElementById('focus-pet-identity');
    const growthHint = document.getElementById('focus-pet-growth-hint');
    const defaultText = document.getElementById('focus-default-mascot-text');
    updateIntentAvailability();  // 依情境決定意圖按鈕顯示/隱藏
    updateOrderButton();         // 依情境決定點餐按鈕顯示/隱藏
    renderPhoneOpenButton();     // 開會、上課：主持人開放使用手機
    renderRestButton();          // 旅行：投票休息
    if (!orb || !petImg) return;
    const face = state.meetingGroupPetFace || '';
    if (sceneCard) sceneCard.classList.toggle('has-pet', !!face);  // 有真寵物 → 藏掉預設球
    if (face) {
        petImg.src = face;
        petImg.style.display = '';
        orb.style.display = 'none';
        document.getElementById('focus-pet-name').textContent = state.meetingGroupPetName || '群組寵物';
        document.getElementById('focus-pet-level').textContent = `LV ${Number(state.meetingGroupPetLevel || 1)}`;
        if (identity) identity.style.display = 'flex';
        if (growthHint) growthHint.style.display = 'flex';
        if (defaultText) defaultText.style.display = 'none';
    } else {
        petImg.removeAttribute('src');
        petImg.style.display = 'none';
        orb.style.display = '';
        if (identity) identity.style.display = 'none';
        if (growthHint) growthHint.style.display = 'none';
        if (defaultText) defaultText.style.display = '';
    }
}

// 暫離到期通知按了「延長一次」：後端同意才延長（每次暫離限一次、會用掉一次暫離次數，
// 延長的時間算在場不專注）。
async function extendIntentFromNotification() {
    try {
        const data = await requestExtendIntent();
        if (data.remaining !== undefined) {
            _intentRemaining = Math.max(0, Number(data.remaining) || 0);
            syncMyExemptUsed(_intentRemaining);
        }
        const sec = Math.max(1, Number(data.remaining_sec) || 0);
        _intentEndMs = Date.now() + sec * 1000;
        state.exemptUntil = _intentEndMs;
        pushDeviationDeadlineToExemptEnd();
        extendBreakCountdown(_intentEndMs);
        clearInterval(_intentTimer);
        renderIntentCountdown();
        _intentTimer = setInterval(renderIntentCountdown, 1000);
        scheduleIntentEnd(sec, { allowExtend: false });   // 已延長過，下一則通知只剩「提前離開」
    } catch (err) {
        showToast(err.message || t('延長暫離失敗'), 'warn');
    }
}

// ── 掃碼點餐 ──
// 點餐網頁開在 App 內建的瀏覽器（原生），只能在那家的點餐網站裡走動，人沒離開 App 所以不算分心。
// 第一次按：開相機掃 QR Code；之後按：直接回到同一個點餐網頁（吃到飽一直加點不用重掃）。
// 點餐網站要把人帶出 App（外部網頁、LINE、付款 App）時，原生先問使用者，同意後由這裡
// 向後端登記一次「帶出」（每場 2 次、每次 15 分鐘），成功才真的打開，並顯示靈動島「點餐中」。
let _orderScanner = null;

function initOrdering() {
    const btn = document.getElementById('btn-order');
    if (btn) btn.onclick = handleOrderButton;
    const close = () => closeOrderScan();
    const x = document.getElementById('btn-order-scan-close');
    const cancel = document.getElementById('btn-order-scan-cancel');
    if (x) x.onclick = close;
    if (cancel) cancel.onclick = close;

    const p = orderingPlugin();
    if (!p || typeof p.addListener !== 'function') return;
    p.addListener('orderingExternal', ({ url }) => goOutToOrder(url));
    p.addListener('orderingClosed', () => updateOrderButton());

    events.on('session:joined', () => {
        // 新的一場：丟掉上一場的點餐網頁
        state.orderingOpen = false;
        try { p.resetOrdering(); } catch (_) {}
        cancelOrderReminders();
        updateOrderButton();
    });
    events.on('session:cleanup', () => {
        state.orderingOpen = false;
        state.orderTripUntil = 0;
        try { p.resetOrdering(); } catch (_) {}
        cancelOrderReminders();
    });
}

function updateOrderButton() {
    const btn = document.getElementById('btn-order');
    const label = document.getElementById('order-btn-label');
    if (!btn) return;
    if (!orderingAvailable()) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    if (label) label.textContent = state.orderingOpen ? t('繼續點餐') : t('掃碼點餐');
}

async function handleOrderButton() {
    const p = orderingPlugin();
    if (!p) return;
    if (state.orderingOpen) {
        try {
            await p.openOrdering({ ...orderingLabels(), tripsLeft: orderTripsLeft() });
            return;
        } catch (_) {
            state.orderingOpen = false;   // 原生那邊已經沒有了（例如 App 重開過），改成重新掃
        }
    }
    openOrderScan();
}

function openOrderScan() {
    const modal = document.getElementById('order-scan-modal');
    const hint = document.getElementById('order-scan-hint');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
    if (typeof Html5Qrcode === 'undefined') {
        if (hint) hint.textContent = t('掃描函式庫載入失敗，請重新整理頁面');
        return;
    }
    if (hint) hint.textContent = t('對準桌上的點餐 QR Code。點餐網頁會開在 App 裡，不算分心。');
    _orderScanner = new Html5Qrcode('order-scan-reader');
    _orderScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => {
            const url = String(text || '').trim();
            if (!/^https?:\/\//i.test(url)) {
                if (hint) hint.textContent = t('這個 QR Code 不是點餐網址，再試一次。');
                return;
            }
            closeOrderScan();
            startOrdering(url);
        },
        () => { /* 每一格沒掃到，略過 */ }
    ).catch(() => {
        if (hint) hint.textContent = t('沒辦法打開相機，請到設定允許相機權限。');
    });
}

function closeOrderScan() {
    const modal = document.getElementById('order-scan-modal');
    if (modal) modal.classList.add('hidden');
    if (_orderScanner) {
        const s = _orderScanner;
        _orderScanner = null;
        try { s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch (_) {} }); } catch (_) {}
    }
}

async function startOrdering(url) {
    const p = orderingPlugin();
    if (!p) return;
    try {
        await p.openOrdering({ url, ...orderingLabels(), tripsLeft: orderTripsLeft() });
        state.orderingOpen = true;
        updateOrderButton();
    } catch (err) {
        showToast(err?.message || t('打不開這個點餐網址'), 'warn');
    }
}

// 原生問過使用者、同意離開 App 之後：先跟後端登記帶出，成功才真的打開外部頁面或 App。
async function goOutToOrder(url) {
    const p = orderingPlugin();
    if (!p) return;
    try {
        const data = await requestOrderTrip();
        const windowSec = Math.max(1, Number(data.window_sec) || 900);
        const remindSec = Math.max(0, Number(data.remind_sec) || 600);
        state.orderTripUntil = Date.now() + windowSec * 1000;
        const me = state.roomMembers?.[state.userId];
        if (me) me.order_trips_used = Math.max(0, ORDER_TRIP_LIMIT - (Number(data.trips_left) || 0));
        try { await p.setOrderingTripsLeft({ n: Number(data.trips_left) || 0 }); } catch (_) {}
        await startOrderActivity(remindSec);        // 先開「點餐中」，離開前景時就不會另開寬限倒數
        scheduleOrderReminders(remindSec, windowSec);
        await p.openExternal({ url });
    } catch (err) {
        try {
            await p.showOrderingMessage({ title: t('現在無法離開 App 點餐'), message: err?.message || '', ok: t('好') });
        } catch (_) {}
    }
}

// ── 離開／結束聚會 ──
// 主持人：結束整場，或自己先離開（後端自動把主持交給目前連續專注最久的人）。
// 其他人：只離開自己，分數結算到離開為止，之後可加回。
function openLeaveSheet() {
    const isHost = !!state.amIHost;
    const othersPresent = presentMemberEntries().some(([uid]) => uid !== state.userId);
    const show = (id, visible) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    };
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    const isClass = state.currentContext === 'class';
    setText('leave-sheet-title', isHost ? (isClass ? t('結束這堂課') : t('結束或離開')) : t('離開聚會'));
    show('btn-leave-end-all', isHost);
    // 主持人是最後一個在場的人時，離開就等於結束，只留「結束整場」一個選項；
    // 上課老師也只能結束整場（不然主持權會交到學生手上）
    show('btn-leave-self', !isHost || (othersPresent && !isClass));

    if (isHost) {
        setText('leave-self-title', t('我先離開'));
        setText('leave-self-note', state.currentContext === 'meeting'
            ? t('會議繼續，選一位接手主持的人')
            : t('聚會繼續，主持交給最專心的人'));
    } else {
        const left = myRejoinsLeft();
        setText('leave-self-title', t('離開聚會'));
        setText('leave-self-note', left > 0
            ? t('分數算到現在，還能加回 {n} 次', { n: left })
            : t('分數算到現在，離開後無法再加回'));
    }

    openSheet('leave-sheet');
}

// 開會：列出在場的其他人，點一位就交給他主持並離開
function openSuccessorSheet() {
    const list = document.getElementById('successor-list');
    if (!list) { leaveSelf(); return; }
    list.innerHTML = '';
    const others = presentMemberEntries().filter(([uid]) => uid !== state.userId);
    if (!others.length) { leaveSelf(); return; }   // 只剩自己 → 離開就是結束
    for (const [uid, m] of others) {
        const name = (m && m.nickname) || t('成員');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pa-sheet-item successor-item';
        const avatar = document.createElement('span');
        avatar.className = 'pa-sheet-item-icon successor-avatar';
        avatar.textContent = name.trim().charAt(0).toUpperCase() || '?';
        const text = document.createElement('span');
        text.className = 'pa-sheet-item-text';
        const strong = document.createElement('strong');
        strong.textContent = name;
        const small = document.createElement('small');
        small.textContent = t('交給 {name} 主持，我先離開', { name });
        text.append(strong, small);
        btn.append(avatar, text);
        btn.onclick = () => leaveSelf({ successorUid: uid });
        list.appendChild(btn);
    }
    openSheet('successor-sheet');
}

let _leaving = false;

async function leaveSelf({ fromTimeout = false, successorUid = null } = {}) {
    closeSheets();
    if (_leaving || !state.roomId) return;
    _leaving = true;
    try {
        const result = await requestLeaveSession({ fromTimeout, successorUid });
        if (state.liveTranscript.active) stopLiveTranscript('已離開聚會，已停止即時轉文字');
        endIntentCountdown();
        state.exemptUntil = 0;
        events.emit('session:left', result);   // wsHandlers 接手顯示個人結算
    } catch (err) {
        showToast(err.message || t('離開聚會失敗'), 'error');
    } finally {
        _leaving = false;
    }
}

// 依「我現在是不是主持人」更新聚會畫面：遊戲區只有主持人看得到，底部按鈕文字跟著換。
// 主持人離開後會自動換人，所以每次 room 更新都要重算（wsHandlers 呼叫）。
export function refreshSessionControls() {
    const hostControls = document.getElementById('host-only-controls');
    if (hostControls && state.currentPhase === 'ACTIVE') {
        hostControls.style.display = state.amIHost ? 'block' : 'none';
    }
    const endBtn = document.getElementById('btn-end-session');
    if (endBtn) endBtn.textContent = state.amIHost ? t('結束聚會') : t('離開聚會');
    // 專心上課的老師不計分：分心次數那一列改成說明
    const teacher = state.currentContext === 'class' && state.amIHost;
    const devLabel = document.querySelector('#view-focus .pa-distraction-label');
    const devCount = document.getElementById('deviation-count');
    if (devLabel) devLabel.textContent = teacher ? t('你是老師，這堂課不計分') : t('我的分心次數');
    if (devCount) devCount.style.display = teacher ? 'none' : '';
}

// ── 底部彈出選單（遊戲區 / 拍照 / 離開）──
function openSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet) return;
    closeSheets();
    sheet.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

function closeSheets() {
    document.querySelectorAll('#view-focus .pa-sheet').forEach(s => s.classList.add('hidden'));
}

function bindSheet(sheetId, cancelId) {
    const sheet = document.getElementById(sheetId);
    const cancel = document.getElementById(cancelId);
    if (cancel) cancel.onclick = closeSheets;
    if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheets(); });
}

function toggleFocusMembersPanel() {
    const panel = document.getElementById('focus-members-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}

async function toggleLiveTranscript() {
    if (state.liveTranscript.active) {
        stopLiveTranscript('已停止即時轉文字');
        return;
    }
    await startLiveTranscript();
}

async function startLiveTranscript() {
    if (!state.roomId) {
        setLiveTranscriptStatus('聚會尚未開始');
        return;
    }
    if (!state.currentUser) {
        setLiveTranscriptStatus('請先登入 Google，才能儲存即時逐字稿');
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setLiveTranscriptStatus('這個瀏覽器不支援即時錄音');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        const mimeType = pickAudioMimeType();

        state.liveTranscript.active = true;
        state.liveTranscript.stream = stream;
        state.liveTranscript.speechRecognition = null;
        state.liveTranscript.speechPreviewActive = false;
        state.liveTranscript.chunkTimer = null;
        state.liveTranscript.currentChunks = [];
        state.liveTranscript.mimeType = mimeType;
        state.liveTranscript.queue = [];
        state.liveTranscript.processing = false;
        state.liveTranscript.startedAtMs = Date.now();
        state.liveTranscript.nextOffsetMs = 0;
        state.liveTranscript.segments = [];

        const list = document.getElementById('live-transcript-list');
        if (list) list.innerHTML = '';
        clearLiveTranscriptPreview();

        const previewStarted = startBrowserLivePreview();
        startLiveRecorderChunk();
        updateLiveTranscriptButton(true);
        setLiveTranscriptStatus(previewStarted
            ? '正在收音：即時預覽已啟動，Whisper 每 8 秒補正式轉錄'
            : '正在收音：此瀏覽器不支援即時預覽，會每 8 秒顯示 Whisper 轉錄；建議用 Chrome 測試即時跳字');
    } catch (err) {
        console.error('start live transcript failed:', err);
        setLiveTranscriptStatus('無法開啟麥克風: ' + (err.message || err));
    }
}

function startLiveRecorderChunk() {
    const live = state.liveTranscript;
    if (!live.active || !live.stream) return;

    const recorder = live.mimeType
        ? new MediaRecorder(live.stream, { mimeType: live.mimeType })
        : new MediaRecorder(live.stream);

    live.mediaRecorder = recorder;
    live.currentChunks = [];

    recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            live.currentChunks.push(event.data);
        }
    };

    recorder.onstop = () => {
        if (live.chunkTimer) {
            clearTimeout(live.chunkTimer);
            live.chunkTimer = null;
        }

        const blobType = live.mimeType || recorder.mimeType || 'audio/webm';
        const blob = new Blob(live.currentChunks, { type: blobType });
        live.currentChunks = [];

        if (blob.size >= 1024) {
            const offsetMs = live.nextOffsetMs;
            live.nextOffsetMs += live.chunkMs;
            live.queue.push({ blob, offsetMs, mimeType: blobType });
            processLiveTranscriptQueue();
        } else if (live.active) {
            setLiveTranscriptStatus('錄音片段太短，請持續說話幾秒');
        }

        if (live.active) {
            startLiveRecorderChunk();
        } else {
            cleanupLiveTranscriptStream();
        }
    };

    recorder.onerror = (event) => {
        console.error('live transcript recorder error:', event.error || event);
        stopLiveTranscript('錄音失敗，已停止');
    };

    recorder.start();
    live.chunkTimer = setTimeout(() => {
        if (recorder.state !== 'inactive') {
            try { recorder.requestData(); } catch (_) { /* noop */ }
            try { recorder.stop(); } catch (_) { /* noop */ }
        }
    }, live.chunkMs);
}

export function stopLiveTranscript(message = '') {
    const live = state.liveTranscript;
    live.active = false;
    stopBrowserLivePreview();
    if (live.chunkTimer) {
        clearTimeout(live.chunkTimer);
        live.chunkTimer = null;
    }
    if (live.mediaRecorder && live.mediaRecorder.state !== 'inactive') {
        try { live.mediaRecorder.requestData(); } catch (_) { /* noop */ }
        try { live.mediaRecorder.stop(); } catch (_) { /* noop */ }
    } else {
        cleanupLiveTranscriptStream();
    }
    updateLiveTranscriptButton(false);
    clearLiveTranscriptPreview();
    if (message) setLiveTranscriptStatus(message);
}

function cleanupLiveTranscriptStream() {
    const live = state.liveTranscript;
    if (live.stream) {
        live.stream.getTracks().forEach(track => track.stop());
    }
    live.mediaRecorder = null;
    live.stream = null;
    live.currentChunks = [];
}

function startBrowserLivePreview() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return false;

    const live = state.liveTranscript;
    const languageEl = document.getElementById('live-transcript-language');
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getSpeechPreviewLanguage(languageEl?.value);

    live.speechRecognition = recognition;
    live.speechPreviewActive = true;

    recognition.onstart = () => {
        setLiveTranscriptStatus('即時預覽已啟動；請對著麥克風說話');
    };

    recognition.onspeechstart = () => {
        updateLiveTranscriptPreview('正在聽你說話...');
    };

    recognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const transcript = event.results[i][0]?.transcript || '';
            if (event.results[i].isFinal) {
                finalText += transcript;
            } else {
                interimText += transcript;
            }
        }
        updateLiveTranscriptPreview(interimText || finalText);
        if (finalText.trim()) {
            appendLivePreviewEntry(finalText.trim());
            clearLiveTranscriptPreview();
            _saveSpeechPreviewText(finalText.trim());
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        console.warn('speech preview failed:', event.error || event);
        const message = event.error === 'not-allowed'
            ? '瀏覽器擋住即時預覽麥克風權限；請允許麥克風或改用 Chrome'
            : t('即時預覽暫停（{error}），Whisper 仍會每 8 秒轉錄', { error: event.error || 'unknown' });
        setLiveTranscriptStatus(message);
    };

    recognition.onend = () => {
        if (live.active && live.speechPreviewActive) {
            setTimeout(() => {
                if (live.active && live.speechPreviewActive) {
                    try { recognition.start(); } catch (_) { /* already started */ }
                }
            }, 250);
        }
    };

    try {
        recognition.start();
        return true;
    } catch (err) {
        console.warn('speech preview start failed:', err);
        setLiveTranscriptStatus('即時預覽啟動失敗，Whisper 仍會每 8 秒轉錄');
        return false;
    }
}

function stopBrowserLivePreview() {
    const live = state.liveTranscript;
    live.speechPreviewActive = false;
    if (live.speechRecognition) {
        try { live.speechRecognition.stop(); } catch (_) { /* noop */ }
        live.speechRecognition = null;
    }
}

function getSpeechPreviewLanguage(value) {
    if (value === 'en') return 'en-US';
    if (value === 'zh') return 'zh-TW';
    return navigator.language || 'zh-TW';
}

function updateLiveTranscriptPreview(text) {
    const preview = document.getElementById('live-transcript-preview');
    const textEl = document.getElementById('live-transcript-preview-text');
    if (!preview || !textEl) return;
    const value = (text || '').trim();
    preview.style.display = value ? 'block' : 'none';
    textEl.innerText = value;
}

function clearLiveTranscriptPreview() {
    updateLiveTranscriptPreview('');
}

function pickAudioMimeType() {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
    ];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

async function processLiveTranscriptQueue() {
    const live = state.liveTranscript;
    if (live.processing) return;
    live.processing = true;
    try {
        while (live.queue.length) {
            const chunk = live.queue.shift();
            await transcribeLiveChunk(chunk);
        }
    } finally {
        live.processing = false;
    }
}

async function transcribeLiveChunk(chunk) {
    const languageEl = document.getElementById('live-transcript-language');
    const speakersEl = document.getElementById('live-transcript-speakers');
    const speakerCount = speakersEl ? Number(speakersEl.value || 0) : 0;
    const ext = chunk.mimeType.includes('mp4') ? 'm4a'
        : chunk.mimeType.includes('ogg') ? 'ogg'
            : 'webm';

    const form = new FormData();
    form.append('file', chunk.blob, `live-${chunk.offsetMs}.${ext}`);
    form.append('started_at_ms_offset', String(chunk.offsetMs));
    if (languageEl?.value) form.append('language', languageEl.value);
    if (speakerCount > 0) {
        form.append('min_speakers', String(speakerCount));
        form.append('max_speakers', String(speakerCount));
    }

    setLiveTranscriptStatus(t('轉錄中... 佇列 {count} 段，請稍等', { count: state.liveTranscript.queue.length }));
    try {
        const { res, data } = await apiFetch(`/api/meetings/${state.roomId}/transcripts/audio`, {
            method: 'POST',
            body: form,
        });
        if (!res.ok || !data || data.status !== 'success') {
            throw new Error((data && data.detail) || '轉錄失敗');
        }
        appendLiveTranscriptEntries(data.entries || []);
        const diarization = data.diarization ? '已分辨說話者' : '未啟用說話者分離';
        setLiveTranscriptStatus(t('已儲存 {saved} 段（{engine}，{diarization}）', { saved: data.saved, engine: data.engine, diarization }));
    } catch (err) {
        console.error('live chunk transcript failed:', err);
        setLiveTranscriptStatus(t('某段轉錄失敗: {error}', { error: err.message || err }));
    }
}

function appendLiveTranscriptEntries(entries) {
    const list = document.getElementById('live-transcript-list');
    if (!list) return;
    entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'live-transcript-item';
        const speaker = entry.speaker_name || entry.speaker_uid || 'Speaker';
        item.innerHTML = `
            <strong>${escHtml(speaker)}</strong>
            <span>${escHtml(entry.text || '')}</span>
        `;
        list.appendChild(item);
        state.liveTranscript.segments.push(entry);
    });
    list.scrollTop = list.scrollHeight;
}

function appendLivePreviewEntry(text) {
    const list = document.getElementById('live-transcript-list');
    if (!list || !text) return;
    const item = document.createElement('div');
    item.className = 'live-transcript-item live-transcript-item-preview';
    item.innerHTML = `
        <strong>即時預覽</strong>
        <span>${escHtml(text)}</span>
    `;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
}

function setLiveTranscriptStatus(message) {
    const el = document.getElementById('live-transcript-status');
    if (el) el.innerText = message;
}

function updateLiveTranscriptButton(active) {
    const btn = document.getElementById('btn-live-transcript-toggle');
    if (!btn) return;
    btn.innerHTML = active
        ? '<i data-lucide="mic-off"></i> 停止錄音'
        : '<i data-lucide="mic"></i> 開始錄音';
    btn.classList.toggle('recording', active);
    if (window.lucide) window.lucide.createIcons();
}

function handleMeetingPhotoClick(inputId) {
    if (!state.roomId) {
        alert(t('聚會尚未建立'));
        return;
    }
    startPhotoMode();
    const input = document.getElementById(inputId);
    input.value = '';
    input.click();
}

async function handleMeetingPhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    endPhotoMode();
    if (!file) return;
    const fromCamera = e.target.id === 'meeting-camera-input';
    const saved = fromCamera ? (await autoSaveCapturedPhoto(file)) === 'saved' : false;
    await uploadCapturedPhoto(file, { saved });
}

// ── 相機：手機用原生相機(input capture)，電腦用網頁鏡頭(getUserMedia) ──
let _meetingCamStream = null;
const _isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function handleMeetingCameraClick() {
    if (!state.roomId) { alert(t('聚會尚未建立')); return; }
    if (_isMobileDevice() || !navigator.mediaDevices?.getUserMedia) {
        // 手機（或不支援 getUserMedia）→ 原生相機
        handleMeetingPhotoClick('meeting-camera-input');
    } else {
        openMeetingCameraModal();  // 電腦 → 網頁鏡頭
    }
}

async function openMeetingCameraModal() {
    const modal = document.getElementById('meeting-camera-modal');
    const video = document.getElementById('mc-cam-video');
    if (!modal || !video) { handleMeetingPhotoClick('meeting-camera-input'); return; }
    startPhotoMode();
    try {
        _meetingCamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = _meetingCamStream;
        modal.style.display = 'flex';
    } catch (err) {
        endPhotoMode();
        alert(t('無法開啟相機：') + (err.message || err));
    }
}

function closeMeetingCameraModal() {
    const modal = document.getElementById('meeting-camera-modal');
    if (modal) modal.style.display = 'none';
    if (_meetingCamStream) {
        _meetingCamStream.getTracks().forEach(tr => tr.stop());
        _meetingCamStream = null;
    }
    endPhotoMode();
}

async function captureMeetingPhoto() {
    const video = document.getElementById('mc-cam-video');
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    closeMeetingCameraModal();
    if (!blob) return;
    await uploadCapturedPhoto(new File([blob], `meeting-${Date.now()}.jpg`, { type: 'image/jpeg' }));
}

async function uploadCapturedPhoto(file, { saved = false } = {}) {
    try {
        showToast(t('照片上傳中…'), 'info');
        await uploadMeetingPhoto(state.roomId, file);
        showToast(saved ? t('照片已上傳，也存到手機了') : t('照片已上傳'), 'success');
    } catch (err) {
        console.error('upload photo failed:', err);
        if (saved) showToast(t('上傳到聚會相簿失敗，但照片已經存到手機了'), 'error');
        else showToast(t('照片上傳失敗:') + (err.message || err), 'error');
    }
}

// 結束整場聚會（只有主持人；後端也會擋）。
async function handleEndSession() {
    if (state.liveTranscript.active) stopLiveTranscript('聚會結束，已停止即時轉文字');
    const mins = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0;
    const reason = 'host_ended';
    const roomId = state.roomId;
    let sentByWs = false;

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        sentByWs = sendAction('END_SESSION', { reason, duration_minutes: mins });
    }

    const fallbackPromise = finalizeEndSessionViaHttp(roomId, reason, mins);
    if (sentByWs) {
        fallbackPromise.catch(err => console.warn('HTTP end-session fallback failed:', err));
        setTimeout(() => {
            if (state.currentPhase !== 'SUMMARY') showLocalSummary();
        }, 2500);
        return;
    }

    try {
        await fallbackPromise;
    } catch (err) {
        console.error('end session fallback failed:', err);
        alert(t('聚會紀錄寫入失敗:') + (err.message || err));
    }
    showLocalSummary();
}

async function finalizeEndSessionViaHttp(roomId, reason, mins) {
    if (!roomId || (!state.currentUser && !state.localGuestActive)) return;
    const { res, data } = await apiFetch(`/api/rooms/${roomId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, duration_minutes: mins }),
    });
    if (!res.ok || !data || data.status !== 'success') {
        throw new Error((data && data.detail) || '結束聚會失敗');
    }
}

function showLocalSummary() {
    // Fallback: WS 已斷線，只能本地切換
    state.currentPhase = 'SUMMARY';
    document.body.className = '';
    const timeMs = state.sessionStartTime ? Date.now() - state.sessionStartTime : 0;
    document.getElementById('summary-time').innerText = Math.round(timeMs / 60000);
    document.getElementById('summary-deviations').innerText = state.totalDeviations;
    if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
    import('../../core/router.js').then(({ switchView }) => switchView('view-summary', { replace: true }));
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 把瀏覽器 SpeechRecognition 確認的文字同步存進資料庫，
// 確保即使 Whisper 無法辨識音訊，聚會紀錄仍有逐字稿。
async function _saveSpeechPreviewText(text) {
    if (!text || !state.roomId) return;
    if (!state.currentUser) return; // 訪客不儲存（訪客 id 是 guest- 開頭；Cognito uid 也有 "-"，不能用來判斷）
    const uid = state.currentUser.uid;
    const name = state.currentProfile?.nickname || state.myNickname
        || state.currentUser?.displayName || '我';
    try {
        await apiFetch(`/api/meetings/${state.roomId}/transcripts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entries: [{
                    speaker_uid: uid,
                    speaker_name: name,
                    text,
                    started_at_ms: state.liveTranscript?.startedAtMs
                        ? Date.now() - state.liveTranscript.startedAtMs
                        : 0,
                    duration_sec: 0,
                }],
            }),
        });
    } catch (_) { /* best effort，不影響錄音流程 */ }
}
