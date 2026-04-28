// features/meetings/controller.js — 聚會紀錄列表與詳情
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { switchView } from '../../core/router.js';
import { formatModeLabel, formatEndReason, formatDateTime } from '../../utils/format.js';
import { loadMeetingPhotos } from '../photos/controller.js';

export async function openMeetingsList() {
    if (!state.currentUser) {
        alert('請先登入才能查看聚會紀錄');
        return;
    }
    switchView('view-meetings');
    const listEl = document.getElementById('meetings-list');
    const emptyEl = document.getElementById('meetings-empty');
    listEl.innerHTML = '<p class="hint">讀取中...</p>';
    emptyEl.style.display = 'none';

    try {
        const { data } = await apiFetch('/api/meetings');
        if (!data || data.status !== 'success') throw new Error((data && data.detail) || '讀取失敗');

        listEl.innerHTML = '';
        if (!data.meetings || data.meetings.length === 0) {
            emptyEl.style.display = 'block';
            return;
        }
        data.meetings.forEach(m => {
            const card = document.createElement('div');
            card.className = 'meeting-card' + (m.cover_url ? ' has-cover' : '');
            const modeLabel = formatModeLabel(m.mode);
            const dateLabel = formatDateTime(m.ended_at);
            const coverHtml = m.cover_url
                ? `<div class="mc-cover" style="background-image:url('${m.cover_url}')"></div>`
                : '';
            card.innerHTML = `
                ${coverHtml}
                <div class="mc-body">
                    <div class="mc-mode">${modeLabel}</div>
                    <div class="mc-meta">
                        <span>👥 ${m.member_count || 0} 人</span>
                        <span>⏱ ${m.duration_minutes || 0} 分鐘</span>
                        <span>📅 ${dateLabel}</span>
                    </div>
                </div>`;
            card.onclick = () => openMeetingDetail(m.id);
            listEl.appendChild(card);
        });
    } catch (err) {
        console.error('openMeetingsList failed:', err);
        listEl.innerHTML = `<p class="hint" style="color:#fca5a5;">讀取失敗:${err.message || err}</p>`;
    }
}

export async function openMeetingDetail(meetingId) {
    switchView('view-meeting-detail');
    state.currentMeetingDetailId = meetingId;
    state.currentMeetingIsHost = false;
    state.currentMeetingPhotos = [];
    document.getElementById('md-host').innerText = '讀取中...';
    document.getElementById('md-mode').innerText = '-';
    document.getElementById('md-duration').innerText = '-';
    document.getElementById('md-deviations').innerText = '-';
    document.getElementById('md-time').innerText = '-';
    document.getElementById('md-reason').innerText = '-';
    document.getElementById('md-count').innerText = '0';
    document.getElementById('md-members').innerHTML = '';
    document.getElementById('md-photos-grid').innerHTML = '';
    document.getElementById('md-photo-count').innerText = '0';
    document.getElementById('md-photos-empty').style.display = 'none';
    document.getElementById('md-photos-host-controls').style.display = 'none';

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

        state.currentMeetingIsHost = !!(state.currentUser && m.host_uid && state.currentUser.uid === m.host_uid);
        if (state.currentMeetingIsHost) {
            document.getElementById('md-photos-host-controls').style.display = 'block';
        }
        await loadMeetingPhotos(meetingId);
    } catch (err) {
        console.error('openMeetingDetail failed:', err);
        document.getElementById('md-host').innerText = '讀取失敗:' + (err.message || err);
    }
}
