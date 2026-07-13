// features/meetings/controller.js — 聚會紀錄列表與詳情
import { state } from '../../core/state.js';
import { apiFetch, setProtectedImage } from '../../core/api.js';
import { switchView } from '../../core/router.js';
import { formatModeLabel, formatEndReason, formatDateTime } from '../../utils/format.js';
import { loadMeetingPhotos } from '../photos/controller.js';
import { t } from '../../core/i18n.js';

const MEETINGS_DISPLAY_LIMIT = 10;
let _allMeetings = [];
let _showFavoritesOnly = false;

export async function openMeetingsList() {
    if (!state.currentUser) {
        alert(t('請先登入才能查看聚會紀錄'));
        return;
    }
    _showFavoritesOnly = false;
    _updateMeetingsHeader();
    switchView('view-meetings');
    const listEl = document.getElementById('meetings-list');
    const emptyEl = document.getElementById('meetings-empty');
    listEl.innerHTML = '<p class="hint">讀取中...</p>';
    emptyEl.style.display = 'none';

    try {
        const { data } = await apiFetch('/api/meetings');
        if (!data || data.status !== 'success') throw new Error((data && data.detail) || '讀取失敗');
        _allMeetings = data.meetings || [];
        _renderMeetingsList();
    } catch (err) {
        console.error('openMeetingsList failed:', err);
        listEl.innerHTML = `<p class="hint" style="color:#fca5a5;">讀取失敗:${err.message || err}</p>`;
    }
}

export function openFavoritesList() {
    _showFavoritesOnly = true;
    _updateMeetingsHeader();
    _renderMeetingsList();
}

function _updateMeetingsHeader() {
    const title = document.getElementById('meetings-page-title');
    const btn = document.getElementById('btn-meetings-favorites');
    const backBtn = document.getElementById('btn-meetings-back');
    if (_showFavoritesOnly) {
        if (title) title.textContent = '收藏的聚會';
        if (btn) btn.style.display = 'none';
        if (backBtn) backBtn.onclick = () => { _showFavoritesOnly = false; _updateMeetingsHeader(); _renderMeetingsList(); };
    } else {
        if (title) title.textContent = '聚會紀錄';
        if (btn) btn.style.display = '';
    }
}

function _getDisplayedMeetings() {
    const visible = _allMeetings.filter(m => !m.is_hidden);
    const favorites = visible.filter(m => m.is_favorited);
    const nonFavorites = visible.filter(m => !m.is_favorited);
    const slots = Math.max(0, MEETINGS_DISPLAY_LIMIT - favorites.length);
    const combined = [...favorites, ...nonFavorites.slice(0, slots)];
    // 依日期新→舊排序
    combined.sort((a, b) => (b.ended_at || '') > (a.ended_at || '') ? 1 : -1);
    return combined;
}

function _buildCard(m) {
    const card = document.createElement('div');
    card.className = 'mt-card' + (m.cover_content_path ? ' has-cover' : '');
    const title = escHtml(t(formatModeLabel(m.mode)));
    const dateLabel = escHtml(formatDateTime(m.ended_at));
    // 封面是 private blob：先放空的 .mc-cover，稍後用帶 token 的 setProtectedImage 填背景
    const coverHtml = m.cover_content_path
        ? '<div class="mc-cover"></div>'
        : '';
    const groupTag = m.group_name
        ? `<span class="mt-group-tag">${escHtml(m.group_name)}</span>`
        : '';
    card.innerHTML = `
        ${coverHtml}
        <div class="mt-card-body">
            <div class="mt-card-top">
                <span class="mt-card-name">${title}</span>
                <div class="mt-card-actions">
                    <button class="btn-mc-fav${m.is_favorited ? ' active' : ''}" title="${m.is_favorited ? '取消收藏' : '收藏'}">${m.is_favorited ? '♥' : '♡'}</button>
                    <button class="btn-mc-delete" title="刪除紀錄">✕</button>
                </div>
            </div>
            ${groupTag}
            <div class="mt-card-meta">${dateLabel}</div>
            <div class="mt-card-stats">
                <span class="mt-stat">👥 ${m.member_count || 0} 人</span>
                <span class="mt-stat">⏱ ${m.duration_minutes || 0} 分</span>
                <span class="mt-stat">📱 分心 ${m.total_deviations || 0} 次</span>
            </div>
        </div>`;
    card.onclick = () => openMeetingDetail(m.id);
    card.querySelector('.btn-mc-fav').onclick = (e) => { e.stopPropagation(); _toggleFavorite(m.id); };
    card.querySelector('.btn-mc-delete').onclick = (e) => { e.stopPropagation(); _hideMeeting(m.id); };
    const cover = card.querySelector('.mc-cover');
    if (cover) {
        setProtectedImage(cover, m.cover_content_path, { background: true }).catch(err => {
            console.warn('load protected meeting cover failed:', err);
        });
    }
    return card;
}

function _renderMeetingsList() {
    const listEl = document.getElementById('meetings-list');
    const emptyEl = document.getElementById('meetings-empty');
    if (!listEl) return;

    listEl.innerHTML = '';
    const displayed = _showFavoritesOnly
        ? _allMeetings.filter(m => m.is_favorited)
        : _getDisplayedMeetings();

    if (displayed.length === 0) {
        emptyEl.style.display = 'block';
        emptyEl.textContent = _showFavoritesOnly ? '還沒有收藏任何聚會' : '還沒有任何聚會紀錄，去發起一場吧！';
        return;
    }
    emptyEl.style.display = 'none';

    displayed.forEach(m => listEl.appendChild(_buildCard(m)));
    if (window.lucide) window.lucide.createIcons();
}

async function _toggleFavorite(meetingId) {
    const m = _allMeetings.find(x => x.id === meetingId);
    if (!m) return;
    const prev = m.is_favorited;
    m.is_favorited = !prev;
    _renderMeetingsList();
    try {
        const { data } = await apiFetch(`/api/meetings/${meetingId}/favorite`, { method: 'PATCH' });
        if (!data || data.status !== 'success') throw new Error();
    } catch {
        m.is_favorited = prev;  // revert
        _renderMeetingsList();
    }
}

async function _hideMeeting(meetingId) {
    const m = _allMeetings.find(x => x.id === meetingId);
    if (!m) return;
    m.is_hidden = true;
    m.is_favorited = false;
    _renderMeetingsList();
    try {
        const { res } = await apiFetch(`/api/meetings/${meetingId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
    } catch {
        m.is_hidden = false;  // revert
        _renderMeetingsList();
    }
}

export async function openMeetingDetail(meetingId) {
    switchView('view-meeting-detail');
    state.currentMeetingDetailId = meetingId;
    state.currentMeetingIsHost = false;
    state.currentMeetingMembers = [];
    state.currentMeetingNewspaper = null;
    state.currentMeetingPhotos = [];
    document.getElementById('md-host').innerText = '讀取中...';
    document.getElementById('md-mode').innerText = '-';
    document.getElementById('md-duration').innerText = '-';
    document.getElementById('md-deviations').innerText = '-';
    document.getElementById('md-time').innerText = '-';
    document.getElementById('md-reason').innerText = '-';
    document.getElementById('md-count').innerText = '0';
    document.getElementById('md-members').innerHTML = '';
    document.getElementById('md-deviation-ranking-section').style.display = 'none';
    document.getElementById('md-deviation-ranking').innerHTML = '';
    document.getElementById('md-photos-grid').innerHTML = '';
    document.getElementById('md-photo-count').innerText = '0';
    document.getElementById('md-photos-empty').style.display = 'none';
    document.getElementById('md-photos-host-controls').style.display = 'none';
    resetNewspaperPanel();

    try {
        const { data } = await apiFetch(`/api/meetings/${meetingId}`);
        if (!data || data.status !== 'success') throw new Error((data && data.detail) || '讀取失敗');
        const m = data.meeting;

        document.getElementById('md-host').innerText = m.host_nickname || '(未知)';
        document.getElementById('md-mode').innerText = formatModeLabel(m.mode);
        document.getElementById('md-duration').innerText = m.duration_minutes || 0;
        document.getElementById('md-deviations').innerText = m.total_deviations || 0;
        document.getElementById('md-time').innerText = formatDateTime(m.ended_at);
        document.getElementById('md-reason').innerText = formatEndReason(m.end_reason);

        const members = m.members_snapshot || [];
        state.currentMeetingMembers = members;
        document.getElementById('md-count').innerText = members.length;
        const ul = document.getElementById('md-members');
        ul.innerHTML = '';
        members.forEach(mem => {
            const li = document.createElement('li');
            const name = document.createElement('span');
            name.innerText = mem.nickname || '(無名)';
            li.appendChild(name);
            if (mem.uid === m.host_uid) {
                const tag = document.createElement('span');
                tag.className = 'member-tag host';
                tag.innerText = '(房主)';
                li.appendChild(tag);
            } else if (mem.is_guest) {
                const tag = document.createElement('span');
                tag.className = 'member-tag';
                tag.style.color = 'var(--text-secondary)';
                tag.innerText = '(訪客)';
                li.appendChild(tag);
            }
            ul.appendChild(li);
        });

        renderMdDeviationRanking(m.deviation_ranking || [], state.currentUser?.uid);

        state.currentMeetingIsHost = !!(state.currentUser && m.host_uid && state.currentUser.uid === m.host_uid);
        document.getElementById('md-photos-host-controls').style.display = 'block';
        await loadMeetingPhotos(meetingId);
        await loadMeetingTranscripts(meetingId);
        await loadMeetingNewspaper(meetingId);
    } catch (err) {
        console.error('openMeetingDetail failed:', err);
        document.getElementById('md-host').innerText = '讀取失敗:' + (err.message || err);
    }
}

function renderMdDeviationRanking(ranking, myUid) {
    const section = document.getElementById('md-deviation-ranking-section');
    const ul = document.getElementById('md-deviation-ranking');
    if (!section || !ul || !ranking.length) return;

    const medals = ['🥇', '🥈', '🥉'];
    ranking.forEach((item, i) => {
        const isMe = item.uid === myUid;
        const li = document.createElement('li');
        li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:6px 4px; border-bottom:1px solid var(--border);';
        if (i === ranking.length - 1) li.style.borderBottom = 'none';
        const medal = medals[i] || `${i + 1}.`;
        const nameStyle = isMe ? 'font-weight:700; color:var(--accent-fire, #ff6b35);' : '';
        li.innerHTML = `
            <span style="${nameStyle}">${medal} ${escHtml(item.nickname || item.uid)}${isMe ? ' (我)' : ''}</span>
            <span style="font-weight:700;">${item.deviations} 次</span>
        `;
        ul.appendChild(li);
    });
    section.style.display = '';
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export async function saveMeetingTranscriptFromInput() {
    const meetingId = state.currentMeetingDetailId;
    const input = document.getElementById('md-transcript-input');
    const status = document.getElementById('md-transcript-status');
    if (!meetingId || !input) return;

    const entries = parseTranscriptInput(input.value);
    if (!entries.length) {
        if (status) status.innerText = '請先輸入逐字稿';
        return;
    }

    const btn = document.getElementById('btn-md-save-transcript');
    const oldText = btn ? btn.innerText : '';
    if (btn) {
        btn.disabled = true;
        btn.innerText = '儲存中...';
    }
    if (status) status.innerText = '';

    try {
        const { res, data } = await apiFetch(`/api/meetings/${meetingId}/transcripts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries }),
        });
        if (!res.ok || !data || data.status !== 'success') {
            throw new Error((data && data.detail) || '儲存失敗');
        }
        input.value = '';
        if (status) status.innerText = t('已儲存 {saved} 段逐字稿', { saved: data.saved });
    } catch (err) {
        console.error('save transcript failed:', err);
        if (status) status.innerText = t('儲存失敗: {error}', { error: err.message || err });
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = oldText;
        }
    }
}

export async function transcribeMeetingAudio() {
    const meetingId = state.currentMeetingDetailId;
    const input = document.getElementById('md-audio-input');
    const status = document.getElementById('md-transcript-status');
    const file = input?.files?.[0];
    if (!meetingId || !file) {
        if (status) status.innerText = '請先選擇音檔';
        return;
    }

    const btn = document.getElementById('btn-md-transcribe-audio');
    const oldText = btn ? btn.innerText : '';
    if (btn) {
        btn.disabled = true;
        btn.innerText = '轉錄中...';
    }
    if (status) status.innerText = '正在轉錄音檔，第一次載入模型會比較久';

    const form = new FormData();
    form.append('file', file);
    form.append('language', 'zh');

    try {
        const { res, data } = await apiFetch(`/api/meetings/${meetingId}/transcripts/audio`, {
            method: 'POST',
            body: form,
        });
        if (!res.ok || !data || data.status !== 'success') {
            throw new Error((data && data.detail) || '音檔轉錄失敗');
        }
        if (status) status.innerText = t('已轉錄並儲存 {saved} 段（{engine}）', { saved: data.saved, engine: data.engine });
        await loadMeetingTranscripts(meetingId);
        await loadMeetingNewspaper(meetingId);
    } catch (err) {
        console.error('audio transcript failed:', err);
        if (status) status.innerText = t('音檔轉錄失敗: {error}', { error: err.message || err });
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = oldText;
        }
    }
}

export async function generateMeetingNewspaper() {
    const meetingId = state.currentMeetingDetailId;
    if (!meetingId) return;

    const btn = document.getElementById('btn-md-generate-newspaper');
    const oldText = btn ? btn.innerText : '';
    if (btn) {
        btn.disabled = true;
        btn.innerText = '產生中...';
    }

    try {
        const { res, data } = await apiFetch(`/api/meetings/${meetingId}/newspaper/generate`, {
            method: 'POST',
        });
        if (!res.ok || !data || data.status !== 'success') {
            throw new Error((data && data.detail) || '產生失敗');
        }
        renderNewspaper(data.newspaper);
    } catch (err) {
        console.error('generate newspaper failed:', err);
        alert(t('產生聚會回顧報失敗:') + ' ' + (err.message || err));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = oldText;
        }
    }
}

async function loadMeetingNewspaper(meetingId) {
    try {
        const { res, data } = await apiFetch(`/api/meetings/${meetingId}/newspaper`);
        if (res.status === 404) {
            resetNewspaperPanel();
            return;
        }
        if (!res.ok || !data || data.status !== 'success') {
            throw new Error((data && data.detail) || '讀取 newspaper 失敗');
        }
        renderNewspaper(data.newspaper);
    } catch (err) {
        console.warn('load newspaper skipped:', err);
        resetNewspaperPanel();
    }
}

async function loadMeetingTranscripts(meetingId) {
    const input = document.getElementById('md-transcript-input');
    const status = document.getElementById('md-transcript-status');
    if (!input) return;
    try {
        const { res, data } = await apiFetch(`/api/meetings/${meetingId}/transcripts`);
        if (!res.ok || !data || data.status !== 'success') {
            throw new Error((data && data.detail) || `HTTP ${res.status}`);
        }
        const lines = (data.transcripts || []).map(entry => {
            const speaker = entry.speaker_name || entry.speaker_uid || 'Speaker';
            return `${speaker}：${entry.text || ''}`;
        });
        input.value = lines.join('\n');
        if (status && lines.length === 0) status.innerText = '這次聚會沒有逐字稿記錄';
    } catch (err) {
        console.warn('load transcripts skipped:', err);
        if (status) status.innerText = t('逐字稿載入失敗: {error}', { error: err.message || err });
    }
}

function parseTranscriptInput(raw) {
    const lines = String(raw || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    const currentUid = state.currentUser?.uid || state.userId || 'manual';
    const currentName =
        state.currentProfile?.nickname ||
        state.myNickname ||
        state.currentUser?.displayName ||
        '我';

    return lines.map((line, i) => {
        const match = line.match(/^([^:：]{1,30})[:：]\s*(.+)$/);
        const speakerName = match ? match[1].trim() : currentName;
        const text = match ? match[2].trim() : line;
        const member = findMemberByName(speakerName);
        return {
            speaker_uid: member?.uid || currentUid,
            speaker_name: member?.nickname || speakerName,
            text,
            started_at_ms: i * 1000,
            duration_sec: Math.max(2, Math.min(30, Math.round(text.length / 4))),
        };
    }).filter(entry => entry.text);
}

function findMemberByName(name) {
    const norm = String(name || '').trim().toLowerCase();
    if (!norm) return null;
    return (state.currentMeetingMembers || []).find(m =>
        String(m.nickname || '').trim().toLowerCase() === norm ||
        String(m.uid || '').trim().toLowerCase() === norm
    ) || null;
}

function resetNewspaperPanel() {
    state.currentMeetingNewspaper = null;
    const result = document.getElementById('md-newspaper-result');
    const empty = document.getElementById('md-newspaper-empty');
    const status = document.getElementById('md-transcript-status');
    if (result) result.style.display = 'none';
    if (empty) empty.style.display = '';
    if (status) status.innerText = '';
}

function renderNewspaper(news) {
    state.currentMeetingNewspaper = news;
    const result = document.getElementById('md-newspaper-result');
    const empty = document.getElementById('md-newspaper-empty');
    if (!result || !news) return;

    if (empty) empty.style.display = 'none';
    result.style.display = '';

    const cover = document.getElementById('md-news-cover');
    const coverPath = news.cover_photo && news.cover_photo.content_path;
    if (cover) {
        cover.style.display = coverPath ? '' : 'none';
        cover.style.backgroundImage = '';
        if (coverPath) {
            setProtectedImage(cover, coverPath, { background: true }).catch(err => {
                console.warn('load protected newspaper cover failed:', err);
            });
        }
    }

    setText('md-news-subtitle', news.subtitle || 'Gathering recap');
    setText('md-news-title', news.title || 'Party Newspaper');
    setText('md-news-lead', news.lead || '');

    const highlightsSection = document.getElementById('md-news-highlights-section');
    const highlightList = document.getElementById('md-news-highlights');
    if (highlightList) {
        highlightList.innerHTML = '';
        const highlights = news.highlights || [];
        highlights.forEach(item => {
            const li = document.createElement('li');
            li.innerText = item;
            highlightList.appendChild(li);
        });
        if (highlightsSection) {
            highlightsSection.style.display = highlights.length ? '' : 'none';
        }
    }

    const keyList = document.getElementById('md-news-keypoints');
    if (keyList) {
        keyList.innerHTML = '';
        (news.key_points || []).forEach(item => {
            const li = document.createElement('li');
            const speaker = item.speaker ? `<strong>${escHtml(item.speaker)}</strong> ` : '';
            li.innerHTML = `${speaker}${escHtml(item.text || '')}`;
            keyList.appendChild(li);
        });
    }

    const topics = document.getElementById('md-news-topics');
    if (topics) {
        topics.innerHTML = '';
        (news.topics || []).forEach(topic => {
            const pill = document.createElement('span');
            pill.className = 'topic-pill';
            pill.innerText = topic;
            topics.appendChild(pill);
        });
    }

    const participation = document.getElementById('md-news-participation');
    if (participation) {
        participation.innerHTML = '';
        (news.participation || []).forEach(person => {
            const row = document.createElement('div');
            row.className = 'participation-item';
            const score = Number(person.participation_score || 0);
            row.innerHTML = `
                <div>
                    <strong>${escHtml(person.nickname || person.uid || 'Unknown')}</strong>
                    <span>${escHtml(person.role || '')}</span>
                </div>
                <div class="participation-meter" aria-label="participation">
                    <i style="width:${Math.max(0, Math.min(100, score))}%"></i>
                </div>
                <b>${score}</b>
            `;
            participation.appendChild(row);
        });
    }

    const photoStrip = document.getElementById('md-news-photos');
    if (photoStrip) {
        photoStrip.innerHTML = '';
        (news.photos || []).forEach(photo => {
            const tile = document.createElement('div');
            tile.className = 'newspaper-photo';
            setProtectedImage(tile, photo.content_path, { background: true }).catch(err => {
                console.warn('load protected newspaper photo failed:', err);
            });
            photoStrip.appendChild(tile);
        });
        if (!(news.photos || []).length) {
            photoStrip.innerHTML = '<p class="hint">尚未上傳聚會照片</p>';
        }
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}
