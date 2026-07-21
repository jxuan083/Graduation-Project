// views/summary/summary.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';

// 聚會總結頁：隱藏右上角帳號 chip（聚會結束畫面不需要），
// 帳號 chip 藏掉後，語言切換(中/EN)自然變成右上角最右邊的元素。
let _savedChipDisplay = null;

function onShow() {
    const chip = document.getElementById('auth-logged-in');
    if (chip) { _savedChipDisplay = chip.style.display; chip.style.display = 'none'; }
}

function onHide() {
    const chip = document.getElementById('auth-logged-in');
    if (chip && _savedChipDisplay !== null) { chip.style.display = _savedChipDisplay; _savedChipDisplay = null; }
}

export function init() {
    register('view-summary', {
        element: document.getElementById('view-summary'),
        onShow,
        onHide,
    });
    document.getElementById('btn-summary-home')?.addEventListener('click', () => switchView('view-home'));
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
            ? '太棒了！你非常專注，獅子獲得了豐盛養分 🎉'
            : '下次聚會再更專注一點，獅子會更健壯的！'
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
            <span class="ps-rank-count">${Number(member.deviations || 0)} 次</span>
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
