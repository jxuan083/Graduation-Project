// views/group-chat/group-chat.js — 群組聊天室（front-preview screen-group-chat）
// 訊息存 groups/{id}/messages（新後端），開啟時輪詢刷新。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { showToast } from '../../utils/toast.js';

const POLL_MS = 3000;
const AVATAR_COLORS = ['#a8c8e8', '#f5c6b8', '#b8e4c6', '#f5e4a8', '#d8b8e8', '#e8c8a8', '#c8d8e8'];
let pollTimer = null;
let lastRenderedIds = '';

export function init() {
    register('view-group-chat', {
        element: document.getElementById('view-group-chat'),
        onShow,
        onHide: stopPolling,
    });

    document.getElementById('btn-gc-back').onclick = () => switchView('view-group');
    document.getElementById('gc-send').onclick = sendMessage;
    document.getElementById('gc-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
    });
}

function onShow() {
    const g = state.currentGroupDetail;
    if (!g) { switchView('view-home'); return; }
    document.getElementById('gc-title').textContent = (g.name || t('群組')) + t(' 的聊天室');
    lastRenderedIds = '';
    loadMessages(true);
    startPolling();
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => loadMessages(false), POLL_MS);
}
function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function loadMessages(showLoading) {
    const g = state.currentGroupDetail;
    if (!g) return;
    const listEl = document.getElementById('gc-list');
    if (showLoading) listEl.innerHTML = `<p class="hint" style="text-align:center;margin-top:24px;">${t('載入訊息中…')}</p>`;
    try {
        const { res, data } = await apiFetch(`/api/groups/${encodeURIComponent(g.group_id)}/messages`);
        if (!res.ok) {
            if (showLoading) listEl.innerHTML = `<p class="hint error" style="text-align:center;margin-top:24px;">${t('讀取訊息失敗')}</p>`;
            return;
        }
        renderMessages(data?.messages || []);
    } catch (err) {
        if (showLoading) listEl.innerHTML = `<p class="hint error" style="text-align:center;margin-top:24px;">${t('讀取訊息失敗')}</p>`;
    }
}

function renderMessages(msgs) {
    const listEl = document.getElementById('gc-list');
    const myUid = state.currentUser?.uid;
    const idsKey = msgs.map(m => m.id).join(',');
    if (idsKey === lastRenderedIds) return; // 沒新訊息就不重畫（避免捲動被打斷）
    lastRenderedIds = idsKey;

    if (!msgs.length) {
        listEl.innerHTML = `<p class="hint" style="text-align:center;margin-top:24px;">${t('還沒有訊息，說點什麼吧！')}</p>`;
        return;
    }
    listEl.innerHTML = msgs.map((m, i) => {
        const mine = m.sender_uid === myUid;
        const time = fmtTime(m.created_at);
        if (mine) {
            return `<div class="chat-msg me">
                <div class="chat-bubble">${escHtml(m.text)}</div>
                <span class="chat-time">${time}</span>
            </div>`;
        }
        const name = m.sender_nickname || m.sender_uid || '';
        const av = m.sender_avatar
            ? `<div class="chat-av" style="overflow:hidden;"><img src="${escAttr(m.sender_avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
            : `<div class="chat-av" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]};">${escHtml((name || '?')[0].toUpperCase())}</div>`;
        return `<div class="chat-msg them">
            ${av}
            <div><p class="chat-sender-name">${escHtml(name)}</p><div class="chat-bubble">${escHtml(m.text)}</div></div>
            <span class="chat-time">${time}</span>
        </div>`;
    }).join('');
    listEl.scrollTop = listEl.scrollHeight;
}

async function sendMessage() {
    const g = state.currentGroupDetail;
    if (!g) return;
    if (!state.currentUser) { showToast(t('請先登入'), 'info'); return; }
    const input = document.getElementById('gc-input');
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    try {
        const { res, data } = await apiFetch(`/api/groups/${encodeURIComponent(g.group_id)}/messages`, {
            method: 'POST',
            body: JSON.stringify({ text }),
        });
        if (!res.ok) {
            showToast(t('送出失敗：') + (data?.detail || res.status), 'error');
            input.value = text; // 還原讓使用者可重試
            return;
        }
        loadMessages(false);
    } catch (err) {
        showToast(t('送出失敗：') + (err.message || err), 'error');
        input.value = text;
    }
}

function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }
