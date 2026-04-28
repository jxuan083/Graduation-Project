// core/wsHandlers.js — 集中註冊所有 WebSocket 訊息的處理邏輯
// 取代原本散落 200 行的 onmessage if/elif 鏈
import { state } from './state.js';
import { switchView } from './router.js';
import { registerHandler, sendAction, closeWs } from './ws.js';
import { cleanupSession, updateThemeByMode } from './session.js';
import { showToast } from '../utils/toast.js';
import { renderMemberList } from '../features/members/render.js';
import { enterTabooPrepare, cleanupTabooLocalState } from '../features/taboo/controller.js';

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
    registerHandler('QA_ERROR', (msg) => alert('出題失敗:' + msg.message));
}

function handleRoomUpdate(msg) {
    const rs = msg.room_state || {};
    if (rs.host_uid) state.roomHostUid = rs.host_uid;
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
}

function handleRoomCancelled() {
    if (!state.amIHost) {
        try { showToast('聚會已被房主取消', 'warn'); }
        catch (e) { alert('聚會已被房主取消'); }
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
    const mins = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0;
    document.getElementById('summary-time').innerText = mins;
    document.getElementById('summary-deviations').innerText = state.totalDeviations;

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
        if (reason === 'host_left') hint.innerText = '⚠️ 房主已離開此聚會';
        else if (!state.amIHost) hint.innerText = '房主已結束聚會';
        else hint.innerText = '';
    }

    state.currentPhase = 'SUMMARY';
    document.body.className = '';
    if (state.bufferTimerObj) { clearInterval(state.bufferTimerObj); state.bufferTimerObj = null; }
    closeWs();
    switchView('view-summary');
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
    document.getElementById('deviation-count').innerText = state.totalDeviations;
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
        msg.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.innerText = opt;
            btn.className = 'qa-option-btn';
            btn.onclick = () => {
                sendAction('SUBMIT_ANSWER', { answer: opt });
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
        statusEl.innerText = `你已送出答案,等待其他人... (${msg.answered_count}/${msg.total_count})`;
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
            const div = document.createElement('div');
            div.className = 'qa-option-btn';
            div.style.opacity = '1';
            div.style.cursor = 'default';
            if (msg.has_answer && msg.correct_option && opt === msg.correct_option) {
                div.style.background = 'rgba(16, 185, 129, 0.25)';
                div.style.borderColor = '#34d399';
                div.style.color = '#a7f3d0';
                div.innerText = `✅ ${opt}  —  ${count} 票(正解)`;
            } else {
                div.innerText = `${opt}  —  ${count} 票`;
            }
            container.appendChild(div);
        });
    }

    if (questionEl) {
        if (msg.has_answer && msg.correct_option) {
            questionEl.innerText = `📊 正解:${msg.correct_option}(${msg.correct_count || 0} 人答對)`;
        } else {
            questionEl.innerText = '📊 結果統計';
        }
    }
    if (statusEl) statusEl.innerText = '5 秒後返回聚會畫面...';

    let countdown = 5;
    const intv = setInterval(() => {
        countdown--;
        if (statusEl) statusEl.innerText = `${countdown} 秒後返回聚會畫面...`;
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
