// views/focus/focus.js
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import { sendAction } from '../../core/ws.js';
import { apiFetch } from '../../core/api.js';
import { events } from '../../core/events.js';
import { openQaSourcePicker } from '../qa-source/qa-source.js';
import { hostStartTabooGame } from '../../features/taboo/controller.js';
import { startPhotoMode, endPhotoMode, uploadMeetingPhoto } from '../../features/photos/controller.js';
import { openInviteModal } from '../invite-modal/invite-modal.js';
import { t } from '../../core/i18n.js';

export function init() {
    register('view-focus', { element: document.getElementById('view-focus') });

    // 折疊成員清單
    const btnFocusToggle = document.getElementById('btn-focus-members-toggle');
    if (btnFocusToggle) btnFocusToggle.onclick = toggleFocusMembersPanel;

    // 房主發起問答
    const qaBtn = document.getElementById('btn-mode-qa');
    if (qaBtn) qaBtn.addEventListener('click', openQaSourcePicker);

    // 房主發起關鍵字遊戲
    const tabooBtn = document.getElementById('btn-mode-taboo');
    if (tabooBtn) tabooBtn.addEventListener('click', hostStartTabooGame);

    // 房主發起 67 挑戰
    const btn67 = document.getElementById('btn-mode-67');
    if (btn67) btn67.addEventListener('click', () => {
        if (!state.amIHost) return;
        sendAction('START_67_GAME');
    });

    // 參與者拍照 / 上傳
    document.getElementById('btn-meeting-camera').onclick = () => handleMeetingPhotoClick('meeting-camera-input');
    document.getElementById('btn-meeting-album').onclick = () => handleMeetingPhotoClick('meeting-album-input');
    document.getElementById('meeting-camera-input').addEventListener('change', handleMeetingPhotoChange);
    document.getElementById('meeting-album-input').addEventListener('change', handleMeetingPhotoChange);

    // 即時語音轉文字
    const liveBtn = document.getElementById('btn-live-transcript-toggle');
    if (liveBtn) liveBtn.onclick = toggleLiveTranscript;
    events.on('session:cleanup', () => {
        if (state.liveTranscript.active) stopLiveTranscript('已停止即時轉文字');
    });

    // 邀請朋友
    const btnFocusInvite = document.getElementById('btn-focus-invite');
    if (btnFocusInvite) btnFocusInvite.onclick = openInviteModal;

    // 結束聚會
    document.getElementById('btn-end-session').onclick = handleEndSession;
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

function stopLiveTranscript(message = '') {
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
        ? '<i data-lucide="mic-off"></i> 停止'
        : '<i data-lucide="mic"></i> 開始';
    btn.classList.toggle('primary', active);
    btn.classList.toggle('secondary', !active);
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
    const btn = e.target.id === 'meeting-camera-input'
        ? document.getElementById('btn-meeting-camera')
        : document.getElementById('btn-meeting-album');
    const origText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '上傳中...';
    try {
        await uploadMeetingPhoto(state.roomId, file);
        btn.innerText = '上傳成功';
        setTimeout(() => { btn.innerText = origText; btn.disabled = false; }, 1500);
    } catch (err) {
        console.error('upload photo failed:', err);
        alert(t('照片上傳失敗:') + (err.message || err));
        btn.innerText = origText;
        btn.disabled = false;
    }
}

async function handleEndSession() {
    if (state.liveTranscript.active) stopLiveTranscript('聚會結束，已停止即時轉文字');
    const mins = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : 0;
    const reason = state.amIHost ? 'host_ended' : 'member_ended';
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
    if (!roomId || !state.currentUser) return;
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
    import('../../core/router.js').then(({ switchView }) => switchView('view-summary'));
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 把瀏覽器 SpeechRecognition 確認的文字同步存進 Firestore，
// 確保即使 Whisper 無法辨識音訊，聚會紀錄仍有逐字稿。
async function _saveSpeechPreviewText(text) {
    if (!text || !state.roomId) return;
    const uid = state.currentUser?.uid || state.userId;
    if (!uid || uid.includes('-')) return; // 訪客不儲存
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
