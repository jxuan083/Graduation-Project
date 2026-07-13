// features/leaderboard/controller.js — 排行榜載入與渲染
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { switchView } from '../../core/router.js';
import { t } from '../../core/i18n.js';

export function openLeaderboardView() {
    if (!state.currentUser) { alert(t('請先登入')); return; }
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
            hintEl.innerText = t('本週(從 {month}/{day} 週一 00:00 起,台北時區)', { month: pad(d.getMonth()+1), day: pad(d.getDate()) });
        }
        listEl.innerHTML = '';
        if (entries.length === 0) {
            emptyEl.style.display = 'block';
            return;
        }
        // 前三名頒獎台 + 第 4 名之後列表（front-preview screen-leaderboard）
        listEl.appendChild(buildPodium(entries.slice(0, 3), data.me_uid));
        entries.slice(3).forEach((e, i) => listEl.appendChild(buildLeaderboardRow(e, i + 4, data.me_uid)));
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<p class="hint">讀取排行榜失敗(可能需要在 Firebase Console 建立索引)</p>';
    }
}

const LB_AV_COLORS = ['#a8c8e8', '#f5c6b8', '#c8e6c9', '#ffe0b2', '#d8b8e8', '#e8c8a8', '#c8d8e8'];

function avatarInner(e, i) {
    if (e.avatar_url) {
        return `<img src="${escAttr(e.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.visibility='hidden'">`;
    }
    const name = e.nickname || '?';
    return escHtml((String(name).trim()[0] || '?').toUpperCase());
}

// 頒獎台：顯示順序 [第2, 第1, 第3]，第1 在中間且最高
function buildPodium(top, meUid) {
    const wrap = document.createElement('div');
    wrap.className = 'lb-podium';
    const cfg = [
        { idx: 1, av: 60, bar: 60, barBg: 'rgba(155,121,85,0.30)', medal: '🥈' },
        { idx: 0, av: 74, bar: 80, barBg: 'rgba(155,121,85,0.55)', medal: '👑', first: true },
        { idx: 2, av: 54, bar: 44, barBg: 'rgba(155,121,85,0.18)', medal: '🥉' },
    ];
    cfg.forEach(c => {
        const e = top[c.idx];
        if (!e) return;
        const isMe = e.uid === meUid;
        const col = document.createElement('div');
        col.className = 'lb-podium-col';
        col.innerHTML = `
            ${c.first ? '<span class="lb-podium-crown">👑</span>' : ''}
            <div class="lb-podium-avatar" style="width:${c.av}px;height:${c.av}px;background:${LB_AV_COLORS[c.idx]};">
                ${avatarInner(e, c.idx)}
                ${c.first ? '' : `<span class="lb-medal">${c.medal}</span>`}
            </div>
            <p class="lb-podium-name${isMe ? ' me' : ''}">${escHtml(e.nickname || '(無名)')}</p>
            <p class="lb-podium-score${isMe ? ' me' : ''}">${e.score || 0}分</p>
            <div class="lb-podium-bar" style="height:${c.bar}px;background:${c.barBg};"></div>`;
        wrap.appendChild(col);
    });
    return wrap;
}

function buildLeaderboardRow(e, rank, meUid) {
    const row = document.createElement('div');
    row.className = 'lb-row' + (e.uid === meUid ? ' me' : '');
    row.innerHTML = `
        <span class="lb-rank">${rank}</span>
        <div class="lb-avatar" style="width:40px;height:40px;background:${LB_AV_COLORS[(rank - 1) % LB_AV_COLORS.length]};">${avatarInner(e, rank)}</div>
        <div class="lb-info"><p class="lb-name">${escHtml(e.nickname || '(無名)')}</p><p class="lb-sub">${t('本週 {count} 場', { count: e.meetings_count || 0 })}</p></div>
        <span class="lb-score">${e.score || 0}</span>`;
    return row;
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }
