// views/group-chat/group-chat.js — 群組聊天室（front-preview screen-group-chat）
// 訊息存 groups/{id}/messages（新後端），開啟時輪詢刷新。
// 支援：文字 / 圖片（含拍照）/ 語音訊息、跨日日期分隔線（類 IG）。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { storage } from '../../core/firebase.js';
import { apiFetch } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { showToast } from '../../utils/toast.js';

const POLL_MS = 3000;
const AVATAR_COLORS = ['#a8c8e8', '#f5c6b8', '#b8e4c6', '#f5e4a8', '#d8b8e8', '#e8c8a8', '#c8d8e8'];
const MAX_RECORD_SEC = 60;
const IMG_MAX_EDGE = 1600;

let pollTimer = null;
let lastRenderedIds = '';
let uploading = false;

// 錄音狀態
let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recStartAt = 0;
let recTimerId = null;
let recDurationSec = 0;
let recFinishedBlob = null;   // 到達 60 秒自動停止後，等使用者按送出
let recCancelled = false;

// 語音播放（共用一個 Audio，progress 依 data-mid 找目前泡泡）
const player = new Audio();
let playingMid = null;

export function init() {
    register('view-group-chat', {
        element: document.getElementById('view-group-chat'),
        onShow,
        onHide,
    });

    document.getElementById('btn-gc-back').onclick = () => switchView('view-group');
    document.getElementById('gc-send').onclick = sendMessage;
    document.getElementById('gc-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
    });

    // 圖片（手機上 accept="image/*" 可直接選「拍照」或相簿）
    document.getElementById('gc-img-btn').onclick = () => {
        if (!uploading) document.getElementById('gc-img-input').click();
    };
    document.getElementById('gc-img-input').addEventListener('change', onImagePicked);

    // 語音
    document.getElementById('gc-mic-btn').onclick = startRecording;
    document.getElementById('gc-rec-cancel').onclick = cancelRecording;
    document.getElementById('gc-rec-send').onclick = finishRecording;

    // 圖片檢視器
    document.getElementById('gc-img-viewer').onclick = () => {
        document.getElementById('gc-img-viewer').style.display = 'none';
    };

    player.addEventListener('timeupdate', updatePlayingBubble);
    player.addEventListener('ended', () => { playingMid = null; updateAllAudioBubbles(); });
}

function onShow() {
    const g = state.currentGroupDetail;
    if (!g) { switchView('view-home'); return; }
    document.getElementById('gc-title').textContent = t('{name} 的聊天室', { name: g.name || t('群組') });
    lastRenderedIds = '';
    loadMessages(true);
    startPolling();
}

function onHide() {
    stopPolling();
    cancelRecording();
    stopPlayback();
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

// ---------- 渲染 ----------

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
    let lastDayKey = '';
    const parts = [];
    msgs.forEach((m, i) => {
        // 跨日就插一條置中的日期分隔線（類 IG）
        const d = m.created_at ? new Date(m.created_at) : null;
        if (d && !isNaN(d.getTime())) {
            const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            if (dayKey !== lastDayKey) {
                parts.push(`<div class="chat-date-sep"><span>${escHtml(fmtDate(d))}</span></div>`);
                lastDayKey = dayKey;
            }
        }
        const mine = m.sender_uid === myUid;
        const time = fmtTime(m.created_at);
        const bubble = renderBubble(m);
        if (mine) {
            parts.push(`<div class="chat-msg me">${bubble}<span class="chat-time">${time}</span></div>`);
        } else {
            const name = m.sender_nickname || m.sender_uid || '';
            const av = m.sender_avatar
                ? `<div class="chat-av" style="overflow:hidden;"><img src="${escAttr(m.sender_avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
                : `<div class="chat-av" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]};">${escHtml((name || '?')[0].toUpperCase())}</div>`;
            parts.push(`<div class="chat-msg them">
                ${av}
                <div><p class="chat-sender-name">${escHtml(name)}</p>${bubble}</div>
                <span class="chat-time">${time}</span>
            </div>`);
        }
    });
    listEl.innerHTML = parts.join('');
    bindMediaEvents(listEl);
    updateAllAudioBubbles();
    listEl.scrollTop = listEl.scrollHeight;
}

function renderBubble(m) {
    if (m.type === 'image' && m.media_url) {
        return `<div class="chat-bubble chat-img-bubble"><img class="chat-img" src="${escAttr(m.media_url)}" loading="lazy" alt=""></div>`;
    }
    if (m.type === 'audio' && m.media_url) {
        const dur = Math.round(m.duration_sec || 0);
        return `<div class="chat-bubble chat-audio" data-mid="${escAttr(m.id)}" data-url="${escAttr(m.media_url)}" data-dur="${dur}">
            <button type="button" class="audio-play" aria-label="${escAttr(t('語音訊息'))}"></button>
            <div class="audio-track"><div class="audio-prog"></div></div>
            <span class="audio-dur">${fmtDur(dur)}</span>
        </div>`;
    }
    return `<div class="chat-bubble">${escHtml(m.text)}</div>`;
}

function bindMediaEvents(listEl) {
    listEl.querySelectorAll('.chat-img').forEach(img => {
        img.onclick = () => {
            document.getElementById('gc-img-viewer-img').src = img.src;
            document.getElementById('gc-img-viewer').style.display = 'flex';
        };
    });
    listEl.querySelectorAll('.chat-audio').forEach(el => {
        el.querySelector('.audio-play').onclick = () => toggleAudio(el.dataset.mid, el.dataset.url);
    });
}

// ---------- 語音播放 ----------

function toggleAudio(mid, url) {
    if (playingMid === mid && !player.paused) {
        player.pause();
        playingMid = null;
    } else {
        const changed = player.src !== url;
        if (changed) player.src = url;
        if (changed || player.ended) player.currentTime = 0;   // 同一則暫停後再按 = 續播
        playingMid = mid;
        player.play().catch(() => { playingMid = null; showToast(t('播放失敗'), 'error'); });
    }
    updateAllAudioBubbles();
}

function stopPlayback() {
    player.pause();
    playingMid = null;
}

function updateAllAudioBubbles() {
    document.querySelectorAll('#gc-list .chat-audio').forEach(el => {
        const on = el.dataset.mid === playingMid;
        el.classList.toggle('playing', on);
        if (!on) {
            const prog = el.querySelector('.audio-prog');
            if (prog) prog.style.width = '0%';
            const durEl = el.querySelector('.audio-dur');
            if (durEl) durEl.textContent = fmtDur(el.dataset.dur);
        }
    });
}

function updatePlayingBubble() {
    if (!playingMid) return;
    const el = document.querySelector(`#gc-list .chat-audio[data-mid="${CSS.escape(playingMid)}"]`);
    if (!el) return;
    const total = player.duration && isFinite(player.duration) ? player.duration : Number(el.dataset.dur) || 1;
    const pct = Math.min(100, (player.currentTime / total) * 100);
    const prog = el.querySelector('.audio-prog');
    if (prog) prog.style.width = pct + '%';
    const durEl = el.querySelector('.audio-dur');
    if (durEl) durEl.textContent = fmtDur(Math.round(player.currentTime));
}

// ---------- 傳文字 ----------

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

// ---------- 傳圖片 ----------

async function onImagePicked(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const g = state.currentGroupDetail;
    if (!g || !state.currentUser) { showToast(t('請先登入'), 'info'); return; }
    setUploading(true);
    try {
        const blob = await compressImage(file);
        const path = `group-chat/${g.group_id}/${state.currentUser.uid}/${Date.now()}.jpg`;
        const snap = await storage.ref().child(path).put(blob, { contentType: 'image/jpeg' });
        const url = await snap.ref.getDownloadURL();
        await postMediaMessage({ type: 'image', media_url: url });
    } catch (err) {
        showToast(t('上傳失敗：') + (err.message || err), 'error');
    } finally {
        setUploading(false);
    }
}

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objUrl);
            let { width, height } = img;
            const scale = Math.min(1, IMG_MAX_EDGE / Math.max(width, height));
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error(t('圖片處理失敗'))), 'image/jpeg', 0.85);
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error(t('圖片處理失敗'))); };
        img.src = objUrl;
    });
}

// ---------- 語音錄製 ----------

async function startRecording() {
    if (uploading || mediaRecorder) return;
    if (!state.currentUser) { showToast(t('請先登入'), 'info'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        showToast(t('這個瀏覽器不支援錄音'), 'error');
        return;
    }
    try {
        recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
        showToast(t('無法取得麥克風權限'), 'error');
        return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    recChunks = [];
    recFinishedBlob = null;
    recCancelled = false;
    mediaRecorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data?.size) recChunks.push(e.data); };
    mediaRecorder.onstop = onRecorderStopped;
    mediaRecorder.start();
    recStartAt = Date.now();
    recDurationSec = 0;

    document.getElementById('gc-input-bar').style.display = 'none';
    const bar = document.getElementById('gc-record-bar');
    bar.style.display = 'flex';
    bar.classList.add('recording');
    document.getElementById('gc-rec-timer').textContent = '0:00';
    recTimerId = setInterval(() => {
        recDurationSec = Math.floor((Date.now() - recStartAt) / 1000);
        document.getElementById('gc-rec-timer').textContent = fmtDur(recDurationSec);
        if (recDurationSec >= MAX_RECORD_SEC) stopRecorderOnly(); // 60 秒上限：先停，等使用者按送出
    }, 250);
}

function stopRecorderOnly() {
    if (recTimerId) { clearInterval(recTimerId); recTimerId = null; }
    recDurationSec = Math.min(recDurationSec || Math.floor((Date.now() - recStartAt) / 1000), MAX_RECORD_SEC);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    document.getElementById('gc-record-bar').classList.remove('recording');
}

function onRecorderStopped() {
    const mime = (mediaRecorder?.mimeType || 'audio/webm').split(';')[0];
    recFinishedBlob = new Blob(recChunks, { type: mime });
    recChunks = [];
    mediaRecorder = null;
    if (recStream) { recStream.getTracks().forEach(tr => tr.stop()); recStream = null; }
    if (recCancelled) recFinishedBlob = null;
}

function cancelRecording() {
    if (!mediaRecorder && !recFinishedBlob) return;
    recCancelled = true;
    stopRecorderOnly();
    recFinishedBlob = null;
    hideRecordBar();
}

function finishRecording() {
    if (recFinishedBlob) { sendVoiceBlob(); return; }      // 已自動停止（60 秒上限）
    if (!mediaRecorder) return;
    stopRecorderOnly();      // onstop 事件產生完整 blob 後再送出
    waitBlobAndSend();
}

async function waitBlobAndSend() {
    for (let i = 0; i < 40 && !recFinishedBlob; i++) await sleep(50); // 最多等 2 秒
    if (recFinishedBlob) sendVoiceBlob();
}

async function sendVoiceBlob() {
    const blob = recFinishedBlob;
    recFinishedBlob = null;
    hideRecordBar();
    const g = state.currentGroupDetail;
    if (!blob || !blob.size || !g || !state.currentUser) return;
    if (recDurationSec < 1) { showToast(t('錄音太短'), 'info'); return; }
    setUploading(true);
    try {
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const path = `group-chat/${g.group_id}/${state.currentUser.uid}/${Date.now()}.${ext}`;
        const snap = await storage.ref().child(path).put(blob, { contentType: blob.type || 'audio/webm' });
        const url = await snap.ref.getDownloadURL();
        await postMediaMessage({ type: 'audio', media_url: url, duration_sec: recDurationSec });
    } catch (err) {
        showToast(t('上傳失敗：') + (err.message || err), 'error');
    } finally {
        setUploading(false);
    }
}

function hideRecordBar() {
    if (recTimerId) { clearInterval(recTimerId); recTimerId = null; }
    document.getElementById('gc-record-bar').style.display = 'none';
    document.getElementById('gc-input-bar').style.display = 'flex';
}

// ---------- 共用 ----------

async function postMediaMessage(payload) {
    const g = state.currentGroupDetail;
    const { res, data } = await apiFetch(`/api/groups/${encodeURIComponent(g.group_id)}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(data?.detail || res.status);
    loadMessages(false);
}

function setUploading(on) {
    uploading = on;
    ['gc-img-btn', 'gc-mic-btn'].forEach(id => {
        const el = document.getElementById(id);
        el.disabled = on;
        el.classList.toggle('busy', on);
    });
}

function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today - day) / 86400000);
    if (diffDays === 0) return t('今天');
    if (diffDays === 1) return t('昨天');
    const locale = getLang() === 'en' ? 'en-US' : 'zh-TW';
    const opts = { month: 'long', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(locale, opts);
}

function fmtDur(sec) {
    const s = Math.max(0, Number(sec) || 0);
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }
