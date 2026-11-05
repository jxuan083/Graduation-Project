// core/wsHandlers.js — 集中註冊所有 WebSocket 訊息的處理邏輯
// 取代原本散落 200 行的 onmessage if/elif 鏈
import { state } from './state.js';
import { events } from './events.js';
import { switchView } from './router.js';
import { registerHandler, sendAction, closeWs } from './ws.js';
import { cleanupSession, updateThemeByMode } from './session.js';
import { showToast } from '../utils/toast.js';
import { t } from './i18n.js';
import { noteDistraction } from './meetingWeather.js';
import { endCountdown } from './liveActivity.js';
import { startSessionPickupRecording, renderSessionPickupCard } from '../features/pickup/sessionPickups.js';
import { orderingPlugin } from './ordering.js';
import { cancelOrderReminders, cancelPhoneOpenNotifications } from './localNotify.js';
import { renderMemberList } from '../features/members/render.js';
import { sendFriendRequestByUid, loadFriendUidCache, loadFriendRequestsCache } from '../features/friends/controller.js';
import { enterTabooPrepare, cleanupTabooLocalState } from '../features/taboo/controller.js';
import { refreshFocusMascot, refreshSessionControls, stopLiveTranscript, applyIntentGranted, applyIntentRejected, applyPhoneOpen, applyPhoneOpenOverage, renderPhoneOpenAway, applyRestVotes, applyStudyState } from '../views/focus/focus.js?v=83';
import {
    renderSyncMembers,
    resetSyncRitual,
    showAnchorEstablished,
} from '../views/sync-ritual/sync-ritual.js?v=83';

export function registerAllWsHandlers() {
    registerHandler('ROOM_UPDATE', handleRoomUpdate);
    registerHandler('ROOM_CANCELLED', handleRoomCancelled);
    registerHandler('SYNC_STARTED', handleSyncStarted);
    registerHandler('SESSION_ENDED', handleSessionEnded);
    registerHandler('ANCHOR_ESTABLISHED', handleAnchorEstablished);
    registerHandler('PROGRESS_UPDATE', handleProgressUpdate);
    // 誰在 App 外：主持人開放結束後，老師畫面要列出還沒回來的人
    registerHandler('USER_WOKE_SCREEN', (msg) => setMemberScreen(msg.user_id, 'visible'));
    registerHandler('USER_HID_SCREEN', (msg) => setMemberScreen(msg.user_id, 'hidden'));
    registerHandler('PHONE_OPEN_OVERAGE', (msg) => applyPhoneOpenOverage(msg.count, msg.ended_ms));
    registerHandler('DEVIATION_RECORDED', handleDeviationRecorded);
    registerHandler('INTENT_GRANTED', (msg) => applyIntentGranted(msg.window_sec, msg.remaining));
    registerHandler('INTENT_REJECTED', (msg) => applyIntentRejected(msg.reason));
    registerHandler('MODE_CHANGED', handleModeChanged);
    registerHandler('QA_STARTED', handleQaStarted);
    registerHandler('QA_PROGRESS', handleQaProgress);
    registerHandler('QA_FINISHED', handleQaFinished);
    registerHandler('TABOO_STARTED', handleTabooStarted);
    registerHandler('TABOO_ENDED', handleTabooEnded);
    registerHandler('QA_ERROR', (msg) => alert(t('出題失敗:') + msg.message));
    registerHandler('MEMBER_LEFT', handleMemberLeft);
    registerHandler('MEMBER_REJOINED', handleMemberRejoined);
    registerHandler('HOST_CHANGED', handleHostChanged);
    registerHandler('JOIN_REJECTED', handleJoinRejected);
    registerHandler('ACTION_REJECTED', (msg) => toast(msg.reason || t('操作沒有成功'), 'warn'));
    // 自己按了「離開聚會」（focus view 送出 HTTP 成功後）→ 顯示個人結算
    events.on('session:left', showLeftSummary);
}

function setMemberScreen(uid, screenState) {
    const m = state.roomMembers?.[uid];
    if (!m) return;
    m.state = screenState;
    renderPhoneOpenAway();
}

function toast(message, kind) {
    try { showToast(message, kind); } catch (e) { /* noop */ }
}

function handleRoomUpdate(msg) {
    const rs = msg.room_state || {};
    // 主持人離開後會自動換人：畫面上的「房主」與主持權限都跟著現任主持人走（建立者是 rs.host_uid）
    const actingHost = rs.acting_host_uid || rs.host_uid;
    if (actingHost) {
        state.roomHostUid = actingHost;
        if (rs.status === 'ACTIVE') state.amIHost = actingHost === state.userId;
    }
    state.roomAllParticipants = rs.all_participants || {};
    if (rs.context) state.currentContext = rs.context;  // 成員端也知道情境（意圖按鈕依此決定顯隱）
    // 本場聚會綁定群組的寵物臉（聚會中吉祥物）；沒綁群組 / 群組沒寵物則為空 → focus 顯示動畫球
    state.meetingGroupPetFace = rs.group_pet_face_url || '';
    state.meetingGroupPetName = rs.group_pet_name || '';
    state.meetingGroupPetLevel = Number(rs.group_pet_level || 1);
    state.roomMembers = rs.members || {};
    // 手機與伺服器的時差：房間裡的時間點（休息、限時開放的結束時間）都要先換算成手機時間再比
    if (Number.isFinite(msg.server_now_ms)) state.serverClockOffset = Date.now() - msg.server_now_ms;
    applyRestVotes(rs.rest_votes || [], rs.rest_end_votes || []);   // 旅行：投票休息
    applyPhoneOpen(rs.phone_open || null);   // 主持人開放使用手機（開會、上課）、旅行／約會休息
    applyStudyState(Number(rs.active_started_ms || 0), rs.questions || []);   // 讀書會番茄鐘、問題板
    refreshFocusMascot();
    renderMemberList(state.roomMembers);
    if (state.currentPhase === 'SYNC') renderSyncMembers(state.roomMembers);
    if (state.amIHost) {
        const startBtn = document.getElementById('btn-start-sync');
        if (startBtn) startBtn.classList.remove('disabled');
    }
    // 中途加入／加回者:已 ACTIVE 就直接切到 focus。只在「還沒進到聚會」的階段才切，
    // 否則問答或遊戲進行中有人進出房間（ROOM_UPDATE）會把大家踢回聚會畫面。
    const notInSessionYet = ['HOME', 'WAITING', 'SYNC'].includes(state.currentPhase);
    if (rs.status === 'ACTIVE' && notInSessionYet) {
        state.currentPhase = 'ACTIVE';
        if (!state.sessionStartTime) state.sessionStartTime = Date.now();
        // 加回後畫面上的分心從 0 重新開始（離開前的扣分後端有保留）
        state.myDeviations = Number(rs.members?.[state.userId]?.deviations || 0);
        const devEl = document.getElementById('deviation-count');
        if (devEl) devEl.innerText = state.myDeviations;
        if (rs.mode) updateThemeByMode(rs.mode);
        switchView('view-focus', { replace: true });
        startSessionPickupRecording();
        toast(t('已加入進行中的聚會'), 'success');
    }
    refreshSessionControls();
    // 聚會已結束但尚未跳到結算（例如重連錯過 SESSION_ENDED）
    if (rs.status === 'ENDED' && state.currentPhase !== 'SUMMARY' && rs.final_result) {
        handleSessionEnded(rs.final_result);   // 後端留著結算結果 → 照正常結束顯示分數與排行
        return;
    }
    if (rs.status === 'ENDED' && state.currentPhase !== 'SUMMARY') {
        const mins = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0;
        document.getElementById('summary-time').innerText = mins;
        document.getElementById('summary-deviations').innerText = state.myDeviations;
        // 這條路徑沒收到 SESSION_ENDED，拿不到分數與排行；顯示 — 而不是誤導的 0
        const scoreEl = document.getElementById('summary-score');
        if (scoreEl) scoreEl.innerText = '—';
        renderSummaryPet(rs);
        setLeftSummaryExtras('', false);
        enterSummaryView();
    }
}

// 切到聚會總結頁：停掉分心計時、關掉連線，並整理「拿起手機」的個人回饋卡。
// final=false 是自己先離開（之後可能加回，回饋卡的起點保留）。
function enterSummaryView({ final = true } = {}) {
    renderSessionPickupCard({ final });
    // 掃碼點餐：提醒取消；聚會結束時把點餐網頁丟掉（自己先離開則留著，加回後還能繼續點）
    state.orderTripUntil = 0;
    cancelOrderReminders();
    state.phoneOpen = null;
    cancelPhoneOpenNotifications();
    if (final) {
        state.orderingOpen = false;
        try { orderingPlugin()?.resetOrdering(); } catch (_) {}
    }
    state.currentPhase = 'SUMMARY';
    document.body.className = '';
    if (state.bufferTimerObj) { clearInterval(state.bufferTimerObj); state.bufferTimerObj = null; }
    if (state.hiddenTimerObj) { clearTimeout(state.hiddenTimerObj); state.hiddenTimerObj = null; }
    state.deviationDeadline = null;
    state.exemptUntil = 0;
    state.pendingDeviation = 0;
    endCountdown();   // 聚會結束／自己離開：靈動島倒數一併收掉
    closeWs();
    switchView('view-summary', { replace: true });
}

// 總結頁上只有「提前離開」才用得到的兩樣東西：一句說明、加回聚會的按鈕。
function setLeftSummaryExtras(hintText, canRejoin, rejoinsLeft = 0) {
    const hint = document.getElementById('summary-host-hint');
    if (hint) {
        hint.innerText = hintText;
        hint.style.display = hintText ? '' : 'none';
    }
    const btn = document.getElementById('btn-summary-rejoin');
    if (btn) {
        btn.style.display = canRejoin ? '' : 'none';
        if (canRejoin) btn.innerText = t('加回聚會（還可 {n} 次）', { n: rejoinsLeft });
    }
    if (!canRejoin) state.leftRoomId = null;
}

// 自己提前離開：顯示算到離開為止的個人結算。其他人還在進行，所以沒有排行。
function showLeftSummary(result) {
    const roomId = state.roomId;
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    };
    setText('summary-time', Number(result.duration_minutes || 0));
    setText('summary-score', result.score ?? '—');
    setText('summary-deviations', Number(result.deviations || 0));
    setText('summary-member-count', Object.keys(state.roomMembers || {}).length || 1);
    renderSummaryPet({}, result.score ?? null);
    renderScoreRanking([]);
    renderContextNote(null);
    renderExchangeCard(null);

    const canRejoin = !result.session_ended && Number(result.rejoins_left || 0) > 0;
    if (canRejoin) state.leftRoomId = roomId;
    let hintText = t('你已先離開，分數算到離開為止');
    if (result.score_pending) hintText = t('你已先離開，分數要等老師結束這堂課才會算出來（依你在場的時間比例）');
    if (result.session_ended) hintText = t('所有人都離開了，聚會已結束');
    else if (result.leave_reason === 'exempt_timeout') hintText = t('暫離超時未回來，已自動離開，分數算到暫離到期為止');
    setLeftSummaryExtras(hintText, canRejoin, Number(result.rejoins_left || 0));
    enterSummaryView({ final: !!result.session_ended });
}

function handleMemberLeft(msg) {
    if (msg.user_id === state.userId) return;
    toast(t('{name} 離開了聚會', { name: msg.nickname || t('有成員') }), 'info');
}

function handleMemberRejoined(msg) {
    if (msg.user_id === state.userId) return;
    toast(t('{name} 回來了', { name: msg.nickname || t('有成員') }), 'info');
}

function handleHostChanged(msg) {
    state.roomHostUid = msg.host_uid;
    state.amIHost = msg.host_uid === state.userId;
    refreshSessionControls();
    renderMemberList(state.roomMembers);
    toast(state.amIHost
        ? t('你現在是主持人，可以開遊戲與結束聚會')
        : t('{name} 現在是主持人', { name: msg.nickname || t('有成員') }), 'info');
}

// 進房被拒絕。silent：背景自動重連時發現自己已被離開（暫離超時）→ 顯示那時的個人結算；
// 否則是加回次數用完了 → 回首頁。
function handleJoinRejected(msg) {
    if (msg.silent) {
        if (state.currentPhase !== 'SUMMARY' && msg.result) showLeftSummary(msg.result);
        return;
    }
    toast(msg.reason || t('無法加入這場聚會'), 'warn');
    cleanupSession();
    switchView('view-home', { replace: true });
}

function handleRoomCancelled() {
    if (!state.amIHost) {
        try { showToast('聚會已被房主取消', 'warn'); }
        catch (e) { alert(t('聚會已被房主取消')); }
    }
    cleanupSession();
    switchView('view-home', { replace: true });
}

function handleSyncStarted(msg) {
    state.currentPhase = 'SYNC';
    state.roomMembers = msg.members || state.roomMembers || {};
    resetSyncRitual(state.roomMembers);
    switchView('view-sync-ritual', { replace: true });
}

function handleSessionEnded(msg) {
    if (state.liveTranscript?.active) {
        stopLiveTranscript('聚會結束，已停止即時轉文字');
    }
    const reason = msg.reason || 'host_ended';
    // 優先用後端傳來的值（已同步），fallback 到前端本地計算
    const mins = msg.duration_minutes ?? (state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0);
    const ranking = msg.score_ranking || msg.deviation_ranking || [];
    const myRow = ranking.find(r => r.uid === state.userId);
    // 中途加入／離開過的人，時間與分心顯示自己的（後端累計），不是整場的
    document.getElementById('summary-time').innerText = myRow?.attended_minutes ?? mins;
    document.getElementById('summary-deviations').innerText = myRow?.deviations ?? state.myDeviations;
    const scoreEl = document.getElementById('summary-score');
    if (scoreEl) scoreEl.innerText = myRow ? (myRow.score ?? 0) : '—';
    const memberCountEl = document.getElementById('summary-member-count');
    if (memberCountEl) memberCountEl.innerText = (msg.deviation_ranking || []).length || 0;
    renderSummaryPet(msg, myRow ? myRow.score : null);

    const summaryView = document.getElementById('view-summary');
    let hint = document.getElementById('summary-host-hint');
    if (!hint && summaryView) {
        hint = document.createElement('p');
        hint.id = 'summary-host-hint';
        const h2 = summaryView.querySelector('h2');
        if (h2 && h2.nextSibling) summaryView.insertBefore(hint, h2.nextSibling);
        else summaryView.appendChild(hint);
    }
    if (hint) {
        if (reason === 'host_left') hint.innerText = '房主已離開此聚會';
        else if (reason === 'member_ended') hint.innerText = '有成員結束了聚會';
        else if (!state.amIHost) hint.innerText = '房主已結束聚會';
        else hint.innerText = '';
        hint.style.display = 'none';   // 這句只在「提前離開」的個人結算才顯示
        if (!myRow && state.amIHost && state.currentContext === 'class') {
            hint.innerText = t('你是這堂課的老師，不計分');
            hint.style.display = '';
        }
        if (myRow?.abandoned) {
            // 跑出 App 到聚會結束都沒回來（只有 iOS App 判斷得出）→ 這場 0 分，說清楚原因
            hint.innerText = t('你在聚會結束前跑出 App 沒有回來，這場以 0 分計算');
            hint.style.display = '';
        }
    }

    renderScoreRanking(ranking);
    renderContextNote(msg);
    renderExchangeCard(msg.reason === 'exchange_contacts' ? ranking : null);
    const rejoinBtn = document.getElementById('btn-summary-rejoin');
    if (rejoinBtn) rejoinBtn.style.display = 'none';
    state.leftRoomId = null;

    enterSummaryView();
}

// 情境的結算小結：約會「誰先拿起手機」、讀書會「一起解決了幾個問題」
function renderContextNote(msg) {
    const el = document.getElementById('summary-context-note');
    if (!el) return;
    let text = '';
    if (msg?.context === 'date') {
        const f = msg.first_distracted;
        text = f
            ? (f.uid === state.userId ? t('今晚先拿起手機的是：你') : t('今晚先拿起手機的是：{name}', { name: f.nickname || t('對方') }))
            : t('今晚兩個人都沒有被手機分心，太棒了。');
    } else if (msg?.context === 'study' && msg.study_questions) {
        const { total = 0, solved = 0 } = msg.study_questions;
        text = total ? t('這次一起解決了 {s} 個問題（共 {n} 題）', { s: solved, n: total }) : '';
    }
    el.textContent = text;
    el.style.display = text ? '' : 'none';
}

// 認識新朋友：主持人選「交換聯絡方式」結束 → 5 分鐘交換時間＋成員名單（登入的人可以直接加好友）
let _exchangeTimer = null;
async function renderExchangeCard(ranking) {
    const card = document.getElementById('summary-exchange-card');
    const list = document.getElementById('summary-exchange-list');
    const timer = document.getElementById('summary-exchange-timer');
    const sub = document.getElementById('summary-exchange-sub');
    clearInterval(_exchangeTimer); _exchangeTimer = null;
    if (!card || !list) return;
    if (!ranking) { card.style.display = 'none'; return; }
    card.style.display = '';
    if (state.currentUser) {
        try { await Promise.all([loadFriendUidCache(), loadFriendRequestsCache()]); } catch (_) { /* 讀不到就都顯示「加好友」 */ }
    }
    list.innerHTML = '';
    const others = ranking.filter(r => r.uid && r.uid !== state.userId);
    for (const r of others) {
        const li = document.createElement('li');
        li.className = 'ps-exchange-row';
        const avatar = document.createElement('span');
        avatar.className = 'ps-exchange-avatar';
        const name = r.nickname || t('成員');
        avatar.textContent = name.trim().charAt(0).toUpperCase() || '?';
        const nameEl = document.createElement('span');
        nameEl.className = 'ps-exchange-name';
        nameEl.textContent = name;
        li.append(avatar, nameEl);
        const isGuest = String(r.uid).startsWith('guest-');
        if (state.currentUser && !isGuest) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ps-exchange-add';
            if (state.friendUidSet?.has(r.uid)) { btn.textContent = t('已是好友'); btn.disabled = true; btn.classList.add('done'); }
            else if (state.outgoingPendingSet?.has(r.uid)) { btn.textContent = t('等待回覆中'); btn.disabled = true; btn.classList.add('pending'); }
            else { btn.textContent = t('加好友'); btn.onclick = () => sendFriendRequestByUid(r.uid, btn); }
            li.appendChild(btn);
        }
        list.appendChild(li);
    }
    if (!others.length) {
        const li = document.createElement('li');
        li.className = 'ps-exchange-row ps-exchange-empty';
        li.textContent = t('這場只有你一個人。');
        list.appendChild(li);
    }
    sub.textContent = state.currentUser
        ? t('聚會已經結算，現在想加 LINE、IG 都可以，也可以直接在這裡加好友。')
        : t('聚會已經結算，現在想加 LINE、IG 都可以。登入後也能直接在 App 裡加好友。');
    const endAt = Date.now() + 5 * 60 * 1000;
    const tick = () => {
        const left = Math.max(0, endAt - Date.now());
        const sec = Math.ceil(left / 1000);
        timer.textContent = left > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : t('時間到');
        if (left <= 0) { clearInterval(_exchangeTimer); _exchangeTimer = null; }
    };
    tick();
    _exchangeTimer = setInterval(tick, 1000);
}

// 聚會總結的吉祥物卡：
//  1. 場景沿用「聚會中」那張場景卡（同一情境、同一隻寵物 / 同一顆預設球，絕不是獅子）。
//  2. 文字依「本場聚會分數」分級（拿不到分數時退回用分心次數判斷）。
function renderSummaryPet(msg, myScore) {
    const face = msg.group_pet_face_url || state.meetingGroupPetFace || '';
    const petName = msg.group_pet_name || state.meetingGroupPetName || '群組寵物';

    // --- 直接複製聚會中那張場景卡（同情境、同寵物）到總結頁 ---
    // 關鍵：場景 SVG 用 <defs> 漸層 + fill="url(#id)"。複製後 id 會和聚會中那張撞名，
    // 所以把 clone 內所有 id 與其 url(#id)/href="#id" 參照統一加上 sum- 前綴，
    // 讓這張 clone 自成一體（牆面、寵物顏色才不會失效變透明、露出底色藍天）。
    const sceneWrap = document.getElementById('summary-mascot-scene');
    const focusCard = document.querySelector('#view-focus .pa-scene-card');
    if (sceneWrap && focusCard) {
        const markup = focusCard.outerHTML
            .replace(/id="([^"]+)"/g, 'id="sum-$1"')
            .replace(/url\(#([^)]+)\)/g, 'url(#sum-$1)')
            .replace(/href="#([^"]+)"/g, 'href="#sum-$1"');
        const tpl = document.createElement('template');
        tpl.innerHTML = markup.trim();
        const clone = tpl.content.firstElementChild;
        // 總結頁固定用「剛進聚會」的乾淨晴天版：不帶結束當下的陰/雨天調暗
        clone.classList.remove('weather-cloudy', 'weather-rainy');
        clone.classList.add('weather-clear');
        // 移除只屬於聚會中的互動層（等級 chip、失落對話框、成長提示、外部 Lottie）
        clone.querySelectorAll('.pa-pet-identity, .pa-pet-bubble, .pa-pet-growth-hint, .lottie-container')
            .forEach(el => el.remove());
        sceneWrap.innerHTML = '';
        sceneWrap.appendChild(clone);
    }

    // --- XP 成長徽章 ---
    const xp = document.getElementById('summary-pet-xp');
    if (xp) {
        const gain = Number(msg.pet_xp_gain || 0);
        xp.textContent = gain > 0 ? t('本場成長 +{gain} XP', { gain }) : '';
        xp.style.display = gain > 0 ? 'inline-flex' : 'none';
    }

    const coins = document.getElementById('summary-pet-coins');
    if (coins) {
        const gain = Number(msg.pet_coin_gain || 0);
        coins.textContent = gain > 0 ? t('群組金幣 +{gain}', {gain}) : '';
        coins.style.display = gain > 0 ? 'inline-flex' : 'none';
    }

    // --- 依分數分級的文字 ---
    const mascotMessage = document.getElementById('summary-mascot-message');
    if (mascotMessage) mascotMessage.textContent = summaryMascotMessage(myScore, face ? petName : '');
}

function summaryMascotMessage(myScore, petName) {
    const who = petName ? `${petName}` : t('大家的吉祥物');
    const score = Number.isFinite(Number(myScore)) ? Number(myScore) : null;
    // 有分數就照分數分級；沒有分數（重連漏收結算）退回用分心次數判斷
    let tier;
    if (score !== null) {
        tier = score >= 85 ? 'great' : score >= 60 ? 'good' : 'try';
    } else {
        tier = state.myDeviations <= 3 ? 'great' : state.myDeviations <= 8 ? 'good' : 'try';
    }
    if (tier === 'great') return t('太專注了！這場聚會超棒，{who}獲得了豐盛養分 🎉', { who });
    if (tier === 'good') return t('不錯的一場聚會，{who}也一起成長了，下次再更投入一點！', { who });
    return t('這次分心多了些，下次多陪陪彼此，{who}會更健壯的！', { who });
}

// 聚會分數排行：分數由高到低（後端已排序），每列同時顯示分數與分心次數
function renderScoreRanking(ranking) {
    const section = document.getElementById('summary-score-ranking');
    const ul = document.getElementById('summary-score-list');
    if (!section || !ul) return;
    if (!ranking.length) { section.style.display = 'none'; return; }

    const COLORS = ['#a8c8e8', '#f5c6b8', '#c8e6c9', '#ffe0b2', '#d8b8e8', '#e8c8a8', '#c8d8e8'];
    ul.innerHTML = '';
    ranking.forEach((item, i) => {
        const isMe = item.uid === state.userId;
        const name = item.nickname || item.uid || '';
        const initial = escHtml((String(name).trim()[0] || '?').toUpperCase());
        const score = Number(item.score ?? 0);
        const deviations = Number(item.deviations ?? 0);
        const li = document.createElement('li');
        li.className = 'ps-rank-row' + (isMe ? ' me' : '');
        li.innerHTML = `
            <span class="ps-rank-num">${i + 1}</span>
            <span class="ps-rank-avatar" style="width:36px;height:36px;background:${COLORS[i % COLORS.length]};">${initial}</span>
            <span class="ps-rank-name">${escHtml(name)}${isMe ? ' <span class="ps-rank-me-tag">（你）</span>' : ''}${item.left_early ? ` <span class="ps-rank-me-tag">${escHtml(t('（提前離開）'))}</span>` : ''}</span>
            <span class="ps-rank-stats">
                <span class="ps-rank-score">${escHtml(t('{n} 分', { n: score }))}</span>
                <span class="ps-rank-dev">${escHtml(t('分心 {n} 次', { n: deviations }))}</span>
            </span>
        `;
        ul.appendChild(li);
    });
    section.style.display = '';
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function handleAnchorEstablished(msg = {}) {
    state.currentPhase = 'ACTIVE';
    state.sessionStartTime = Date.now();
    if (Number.isFinite(msg.server_now_ms)) state.serverClockOffset = Date.now() - msg.server_now_ms;
    startSessionPickupRecording();   // 開始錄「拿起手機」的感測資料（只在這支手機上分析）
    showAnchorEstablished().then(() => {
        switchView('view-focus', { replace: true });
        document.body.classList.add('mode-flow');
        refreshSessionControls();
        // 讀書會番茄鐘從聚會開始起算（之後的 ROOM_UPDATE 也會帶，這裡先讓倒數馬上出現）
        if (msg.active_started_ms) applyStudyState(Number(msg.active_started_ms), state.studyQuestions);
    });
}

function handleProgressUpdate(msg) {
    if (!msg.members) return;
    state.roomMembers = msg.members;
    renderMemberList(msg.members);
    renderSyncMembers(msg.members);
}

function handleDeviationRecorded(msg) {
    state.totalDeviations = msg.total_deviations;
    if (msg.user_id === state.userId) {
        state.myDeviations = msg.user_deviations ?? (state.myDeviations + 1);
    }
    document.getElementById('deviation-count').innerText = state.myDeviations;
    noteDistraction(msg.user_id);
}

function handleModeChanged(msg) {
    state.currentRoomMode = msg.mode;
    updateThemeByMode(msg.mode);
}

function handleQaStarted(msg) {
    state.currentPhase = 'QA_GAME';
    switchView('view-qa-game', { replace: true });

    const questionEl = document.getElementById('qa-question-text');
    const container = document.getElementById('qa-options-container');
    const statusEl = document.getElementById('qa-status');

    if (questionEl) questionEl.innerText = msg.question;
    if (statusEl) statusEl.innerText = '';

    if (container) {
        container.innerHTML = '';
        msg.options.forEach((opt, i) => {
            const letter = String.fromCharCode(65 + i); // A/B/C/D
            const btn = document.createElement('button');
            btn.className = 'qag-opt';
            btn.innerHTML = `<span class="qag-opt-label">${letter}</span><span class="qag-opt-text">${escHtml(opt)}</span>`;
            btn.onclick = () => {
                sendAction('SUBMIT_ANSWER', { answer: opt });
                btn.classList.add('selected');
                if (statusEl) statusEl.innerText = '你已送出答案,等待其他人...';
                Array.from(container.children).forEach(b => b.disabled = true);
            };
            container.appendChild(btn);
        });
    }
}

function handleQaProgress(msg) {
    const statusEl = document.getElementById('qa-status');
    if (statusEl && statusEl.innerText.includes('等待其他人')) {
        statusEl.innerText = t('你已送出答案,等待其他人... ({answered}/{total})', { answered: msg.answered_count, total: msg.total_count });
    }
}

function handleQaFinished(msg) {
    const statusEl = document.getElementById('qa-status');
    const container = document.getElementById('qa-options-container');
    const questionEl = document.getElementById('qa-question-text');

    if (container) {
        container.innerHTML = '';
        const sorted = Object.entries(msg.results).sort((a, b) => b[1] - a[1]);
        sorted.forEach(([opt, count]) => {
            const isCorrect = msg.has_answer && msg.correct_option && opt === msg.correct_option;
            const div = document.createElement('div');
            div.className = 'qag-opt qag-result' + (isCorrect ? ' correct' : '');
            const countText = isCorrect ? t('{count} 票(正解)', { count }) : t('{count} 票', { count });
            div.innerHTML = `<span class="qag-opt-text">${escHtml(opt)}</span><span class="qag-opt-count">${escHtml(countText)}</span>`;
            container.appendChild(div);
        });
    }

    if (questionEl) {
        if (msg.has_answer && msg.correct_option) {
            questionEl.innerText = t('正解:{option}({count} 人答對)', { option: t(msg.correct_option), count: msg.correct_count || 0 });
        } else {
            questionEl.innerText = '結果統計';
        }
    }
    if (statusEl) statusEl.innerText = t('5 秒後返回聚會畫面...');

    let countdown = 5;
    const intv = setInterval(() => {
        countdown--;
        if (statusEl) statusEl.innerText = t('{countdown} 秒後返回聚會畫面...', { countdown });
        if (countdown <= 0) {
            clearInterval(intv);
            state.currentPhase = 'ACTIVE';
            switchView('view-focus', { replace: true });
            document.body.classList.add('mode-flow');
            if (statusEl) statusEl.innerText = '';
        }
    }, 1000);
}

function handleTabooStarted() {
    state.currentPhase = 'TABOO_GAME';
    enterTabooPrepare();
}

function handleTabooEnded() {
    cleanupTabooLocalState();
    state.currentPhase = 'ACTIVE';
    switchView('view-focus', { replace: true });
    document.body.classList.add('mode-flow');
    try { showToast('關鍵字遊戲結束', 'info'); } catch (e) {}
}
