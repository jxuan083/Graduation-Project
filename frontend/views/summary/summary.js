// views/summary/summary.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { connectRoom } from '../../core/ws.js';
import { events } from '../../core/events.js';
import { resetSessionCounters } from '../../core/session.js';
import { t } from '../../core/i18n.js';

export function init() {
    // 右上角帳號 chip 在這頁不顯示，由 core/chrome.js 的 refreshAuthBarVisibility 統一處理
    register('view-summary', { element: document.getElementById('view-summary') });
    document.getElementById('btn-summary-home')?.addEventListener('click', () => switchView('view-home', { replace: true }));
    document.getElementById('btn-summary-rejoin')?.addEventListener('click', rejoinLeftSession);
}

// 提前離開後想回來：重新連進同一場聚會。後端認帳號，同一人才算加回（每場有次數上限），
// 連上後 ROOM_UPDATE 會把畫面帶回聚會中；被拒絕（次數用完）則由 JOIN_REJECTED 處理。
async function rejoinLeftSession() {
    const roomId = state.leftRoomId;
    if (!roomId) return;
    const btn = document.getElementById('btn-summary-rejoin');
    if (btn) btn.disabled = true;
    state.leftRoomId = null;
    state.amIHost = false;
    try {
        await connectRoom(roomId, state.userId, state.myNickname, () => {
            state.currentPhase = 'WAITING';
            resetSessionCounters();
            events.emit('session:joined', { roomId, amIHost: false });
        });
    } finally {
        if (btn) btn.disabled = false;
    }
}

export function renderPartySummaryFromMeeting(meeting, newspaper = null) {
    const members = meeting?.members_snapshot || state.currentMeetingMembers || [];
    const ranking = normalizeRanking(meeting, members);
    const myUid = state.currentUser?.uid || state.userId;
    const myRow = ranking.find(item => item.uid === myUid) || ranking.find(item => item.isMe);
    const myDeviations = Number(myRow?.deviations ?? state.myDeviations ?? 0);

    setText('summary-time', Number(meeting?.duration_minutes || newspaper?.stats?.duration_minutes || 0));
    setText('summary-deviations', myDeviations);
    setText('summary-member-count', members.length || ranking.length || Number(newspaper?.stats?.member_count || 0));
    setText(
        'summary-mascot-message',
        myDeviations <= 3
            ? '太專注了！這場聚會超棒，吉祥物獲得了豐盛養分 🎉'
            : '這次分心多了些，下次多陪陪彼此，吉祥物會更健壯的！'
    );

    renderSummaryRanking(ranking, myUid);
}

function normalizeRanking(meeting, members) {
    const byUid = new Map((members || []).map(member => [member.uid, member]));
    const source = Array.isArray(meeting?.deviation_ranking) ? meeting.deviation_ranking : [];
    const ranked = source.map(item => ({
        uid: item.uid,
        nickname: item.nickname || byUid.get(item.uid)?.nickname || item.uid || '成員',
        deviations: Number(item.deviations || 0),
    }));

    if (ranked.length) {
        return ranked.sort((a, b) => a.deviations - b.deviations);
    }

    return (members || []).map(member => ({
        uid: member.uid,
        nickname: member.nickname || member.uid || '成員',
        deviations: Number(member.deviations || 0),
    })).sort((a, b) => a.deviations - b.deviations);
}

function renderSummaryRanking(ranking, myUid) {
    const section = document.getElementById('summary-deviation-ranking');
    const ul = document.getElementById('summary-deviation-list');
    if (!section || !ul) return;
    ul.innerHTML = '';
    if (!ranking.length) {
        section.style.display = 'none';
        return;
    }

    const colors = ['#a8c8e8', '#f4a442', '#f9c8d0', '#f9d5e5', '#c8e6c9', '#d8b8e8'];
    const emojis = ['🐻', '🦊', '🐷', '⭐', '🦁', '🐰'];
    ranking.forEach((member, index) => {
        const isMe = member.uid === myUid;
        const li = document.createElement('li');
        li.className = 'ps-rank-row' + (isMe ? ' me' : '');
        li.innerHTML = `
            <span class="ps-rank-num">${index + 1}</span>
            <span class="ps-rank-avatar" style="width:38px;height:38px;background:${colors[index % colors.length]};">${emojis[index % emojis.length]}</span>
            <span class="ps-rank-name">${escHtml(member.nickname)}${isMe ? ' <span class="ps-rank-me-tag">（我）</span>' : ''}</span>
            <span class="ps-rank-count">${escHtml(t('{n} 次', { n: Number(member.deviations || 0) }))}</span>
        `;
        ul.appendChild(li);
    });
    section.style.display = '';
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
