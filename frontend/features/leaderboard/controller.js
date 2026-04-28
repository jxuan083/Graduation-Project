// features/leaderboard/controller.js — 排行榜載入與渲染
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { switchView } from '../../core/router.js';

export function openLeaderboardView() {
    if (!state.currentUser) { alert('請先登入'); return; }
    switchView('view-leaderboard');
    switchLeaderboardTab(state.currentLeaderboardTab || 'global');
}

export function switchLeaderboardTab(tab) {
    state.currentLeaderboardTab = tab;
    document.getElementById('lb-tab-global').classList.toggle('active', tab === 'global');
    document.getElementById('lb-tab-friends').classList.toggle('active', tab === 'friends');
    refreshLeaderboard();
}

export async function refreshLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    const emptyEl = document.getElementById('leaderboard-empty');
    const hintEl = document.getElementById('leaderboard-period-hint');
    if (!listEl) return;
    listEl.innerHTML = '載入中...';
    emptyEl.style.display = 'none';
    try {
        const path = state.currentLeaderboardTab === 'friends' ? 'friends' : 'global';
        const { data } = await apiFetch(`/api/leaderboard/${path}?period=week`);
        const entries = (data && data.entries) || [];
        if (data && data.period_start) {
            const d = new Date(data.period_start);
            const pad = (n) => String(n).padStart(2, '0');
            hintEl.innerText = `本週(從 ${pad(d.getMonth()+1)}/${pad(d.getDate())} 週一 00:00 起,台北時區)`;
        }
        listEl.innerHTML = '';
        if (entries.length === 0) {
            emptyEl.style.display = 'block';
            return;
        }
        entries.forEach((e, i) => listEl.appendChild(buildLeaderboardRow(e, i, data.me_uid)));
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<p class="hint">讀取排行榜失敗(可能需要在 Firebase Console 建立索引)</p>';
    }
}

function buildLeaderboardRow(e, index, meUid) {
    const row = document.createElement('div');
    row.className = 'leaderboard-row';
    if (e.uid === meUid) row.classList.add('me');

    const rankEl = document.createElement('div');
    rankEl.className = 'lb-rank';
    if (index === 0) rankEl.innerText = '🥇';
    else if (index === 1) rankEl.innerText = '🥈';
    else if (index === 2) rankEl.innerText = '🥉';
    else rankEl.innerText = `#${index + 1}`;
    row.appendChild(rankEl);

    const avatar = document.createElement('img');
    avatar.className = 'lb-avatar';
    avatar.src = e.avatar_url || '';
    avatar.onerror = () => { avatar.style.visibility = 'hidden'; };
    row.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'lb-info';
    const name = document.createElement('div');
    name.className = 'lb-name';
    name.innerText = e.nickname || '(無名)';
    info.appendChild(name);
    const sub = document.createElement('div');
    sub.className = 'lb-sub';
    sub.innerText = `本週 ${e.meetings_count || 0} 場`;
    info.appendChild(sub);
    row.appendChild(info);

    const score = document.createElement('div');
    score.className = 'lb-score';
    score.innerText = e.score || 0;
    row.appendChild(score);

    return row;
}
