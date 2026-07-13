// core/wsHandlers.js — 集中註冊所有 WebSocket 訊息的處理邏輯
// 取代原本散落 200 行的 onmessage if/elif 鏈
import { state } from './state.js';
import { switchView } from './router.js';
import { registerHandler, sendAction, closeWs } from './ws.js';
import { cleanupSession, updateThemeByMode } from './session.js';
import { showToast } from '../utils/toast.js';
import { t } from './i18n.js';
import { renderMemberList } from '../features/members/render.js';
import { enterTabooPrepare, cleanupTabooLocalState } from '../features/taboo/controller.js';
import { refreshFocusMascot } from '../views/focus/focus.js';

export function registerAllWsHandlers() {
    registerHandler('ROOM_UPDATE', handleRoomUpdate);
    registerHandler('ROOM_CANCELLED', handleRoomCancelled);
    registerHandler('SYNC_STARTED', handleSyncStarted);
    registerHandler('SESSION_ENDED', handleSessionEnded);
    registerHandler('ANCHOR_ESTABLISHED', handleAnchorEstablished);
    registerHandler('PROGRESS_UPDATE', handleProgressUpdate);
    registerHandler('USER_WOKE_SCREEN', () => {});
    registerHandler('USER_HID_SCREEN', () => {});
    registerHandler('DEVIATION_RECORDED', handleDeviationRecorded);
    registerHandler('MODE_CHANGED', handleModeChanged);
    registerHandler('QA_STARTED', handleQaStarted);
    registerHandler('QA_PROGRESS', handleQaProgress);
    registerHandler('QA_FINISHED', handleQaFinished);
    registerHandler('TABOO_STARTED', handleTabooStarted);
    registerHandler('TABOO_ENDED', handleTabooEnded);
    registerHandler('QA_ERROR', (msg) => alert(t('出題失敗:') + msg.message));
}

function handleRoomUpdate(msg) {
    const rs = msg.room_state || {};
    if (rs.host_uid) state.roomHostUid = rs.host_uid;
    // 本場聚會綁定群組的寵物臉（聚會中吉祥物）；沒綁群組 / 群組沒寵物則為空 → focus 顯示動畫球
    state.meetingGroupPetFace = rs.group_pet_face_url || '';
    refreshFocusMascot();
    renderMemberList(rs.members || {});
    if (state.amIHost) {
        const startBtn = document.getElementById('btn-start-sync');
        if (startBtn) startBtn.classList.remove('disabled');
    }
    // 中途加入者:已 ACTIVE 就直接切到 focus
    if (!state.amIHost && rs.status === 'ACTIVE' && state.currentPhase !== 'ACTIVE') {
        state.currentPhase = 'ACTIVE';
        if (rs.mode) updateThemeByMode(rs.mode);
        switchView('view-focus');
        try { showToast('已加入進行中的聚會', 'success'); } catch (e) {}
    }
    // 聚會已結束但尚未跳到結算（例如重連錯過 SESSION_ENDED）
    if (rs.status === 'ENDED' && state.currentPhase !== 'SUMMARY') {
        const mins = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0;
        document.getElementById('summary-time').innerText = mins;
        document.getElementById('summary-deviations').innerText = state.myDeviations;
        state.currentPhase = 'SUMMARY';
        document.body.className = '';
        if (state.bufferTimerObj) { clearInterval(state.bufferTimerObj); state.bufferTimerObj = null; }
        if (state.hiddenTimerObj) { clearTimeout(state.hiddenTimerObj); state.hiddenTimerObj = null; }
        state.deviationDeadline = null;
        closeWs();
        switchView('view-summary');
    }
}

function handleRoomCancelled() {
    if (!state.amIHost) {
        try { showToast('聚會已被房主取消', 'warn'); }
        catch (e) { alert(t('聚會已被房主取消')); }
    }
    cleanupSession();
    switchView('view-home');
}

function handleSyncStarted() {
    state.currentPhase = 'SYNC';
    state.isReady = false;
    state.myProgress = 0;
    const progressFill = document.getElementById('sync-progress-fill');
    if (progressFill) {
        progressFill.style.width = '0%';
        progressFill.style.background = "linear-gradient(90deg, #3b82f6, #10b981)";
    }
    const btnHold = document.getElementById('btn-sync-hold');
    if (btnHold) {
        btnHold.innerText = "HOLD";
        btnHold.style.background = "";
    }
    switchView('view-sync-ritual');
}

function handleSessionEnded(msg) {
    const reason = msg.reason || 'host_ended';
    // 優先用後端傳來的值（已同步），fallback 到前端本地計算
    const mins = msg.duration_minutes ?? (state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0);
    document.getElementById('summary-time').innerText = mins;
    document.getElementById('summary-deviations').innerText = state.myDeviations;

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
    }

    renderDeviationRanking(msg.deviation_ranking || []);

    state.currentPhase = 'SUMMARY';
    document.body.className = '';
    if (state.bufferTimerObj) { clearInterval(state.bufferTimerObj); state.bufferTimerObj = null; }
    if (state.hiddenTimerObj) { clearTimeout(state.hiddenTimerObj); state.hiddenTimerObj = null; }
    state.deviationDeadline = null;
    closeWs();
    switchView('view-summary');
}

function renderDeviationRanking(ranking) {
    const section = document.getElementById('summary-deviation-ranking');
    const ul = document.getElementById('summary-deviation-list');
    if (!section || !ul) return;
    if (!ranking.length) { section.style.display = 'none'; return; }

    const COLORS = ['#a8c8e8', '#f5c6b8', '#c8e6c9', '#ffe0b2', '#d8b8e8', '#e8c8a8', '#c8d8e8'];
    ul.innerHTML = '';
    ranking.forEach((item, i) => {
        const isMe = item.uid === state.userId;
        const name = item.nickname || item.uid || '';
        const initial = escHtml((String(name).trim()[0] || '?').toUpperCase());
        const li = document.createElement('li');
        li.className = 'ps-rank-row' + (isMe ? ' me' : '');
        li.innerHTML = `
            <span class="ps-rank-num">${i + 1}</span>
            <span class="ps-rank-avatar" style="width:36px;height:36px;background:${COLORS[i % COLORS.length]};">${initial}</span>
            <span class="ps-rank-name">${escHtml(name)}${isMe ? ' <span class="ps-rank-me-tag">（你）</span>' : ''}</span>
            <span class="ps-rank-count">${item.deviations} 次</span>
        `;
        ul.appendChild(li);
    });
    section.style.display = '';
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function handleAnchorEstablished() {
    state.currentPhase = 'ACTIVE';
    state.sessionStartTime = Date.now();
    switchView('view-focus');
    document.body.classList.add('mode-flow');
    if (state.amIHost) {
        document.getElementById('host-only-controls').style.display = 'block';
    }
}

function handleProgressUpdate(msg) {
    // PROGRESS_UPDATE 在 SYNC 階段使用,目前單純更新成員清單就好
    if (msg.members) renderMemberList(msg.members);
}

function handleDeviationRecorded(msg) {
    state.totalDeviations = msg.total_deviations;
    if (msg.user_id === state.userId) {
        state.myDeviations = msg.user_deviations ?? (state.myDeviations + 1);
    }
    document.getElementById('deviation-count').innerText = state.myDeviations;
}

function handleModeChanged(msg) {
    state.currentRoomMode = msg.mode;
    updateThemeByMode(msg.mode);
}

function handleQaStarted(msg) {
    state.currentPhase = 'QA_GAME';
    switchView('view-qa-game');

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
            questionEl.innerText = t('正解:{option}({count} 人答對)', { option: msg.correct_option, count: msg.correct_count || 0 });
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
            switchView('view-focus');
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
    switchView('view-focus');
    document.body.classList.add('mode-flow');
    try { showToast('關鍵字遊戲結束', 'info'); } catch (e) {}
}

