// views/pet-vote/pet-vote.js — 群組寵物投票（front-preview screen-pet-vote）
// ① 投票選誰的臉（voteForPet）② 選身體造型（updatePet pet_body_emoji）
// 確認 → 進生成寵物臉（view-pet-swap，接現有合成流程）。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { PET_BODY_OPTIONS } from '../../core/config.js?v=39';
import { t } from '../../core/i18n.js';

const BODY_LABELS = {
    '🐰': '兔', '🐻': '熊', '🐱': '貓', '🐶': '狗', '🦊': '狐狸',
    '🐸': '青蛙', '🐧': '企鵝', '🐼': '貓熊', '🐨': '無尾熊', '🐯': '老虎',
};
const AVATAR_COLORS = ['#a8c8e8', '#f5c6b8', '#b8e4c6', '#f5e4a8', '#d8b8e8', '#e8c8a8', '#c8d8e8'];

let currentGroupId = null;
let selectedBody = null;

export function init() {
    register('view-pet-vote', {
        element: document.getElementById('view-pet-vote'),
        onShow,
    });
    document.getElementById('btn-pet-vote-back').onclick = () => switchView('view-group');
    document.getElementById('btn-pet-vote-confirm').onclick = handleConfirm;
}

async function onShow() {
    const g = state.currentGroupDetail;
    if (!g) { switchView('view-home'); return; }
    currentGroupId = g.group_id;
    selectedBody = g.pet_body_emoji || null;
    buildBodyGrid();
    renderMembers(g);

    try {
        const { fetchGroupDetail } = await import('../../features/groups/controller.js?v=39');
        const full = await fetchGroupDetail(currentGroupId);
        if (full) {
            state.currentGroupDetail = { ...g, ...full };
            if (!selectedBody) selectedBody = full.pet_body_emoji || null;
            buildBodyGrid();
            renderMembers(full);
        }
    } catch (err) {
        console.warn('[pet-vote] fetchGroupDetail failed:', err);
    }
}

// ── ① 投票選臉 ──
function renderMembers(g) {
    const grid = document.getElementById('pv-member-grid');
    if (!grid) return;
    const members = g.members || [];
    const votes = g.pet_votes || {};
    const myUid = state.currentUser?.uid;
    const myVote = votes[myUid];
    const total = Object.keys(votes).length || members.length || 1;
    const petTargetUid = g.pet_target_uid;

    grid.innerHTML = members.map((m, i) => {
        const name = escHtml(m.nickname || m.uid);
        const initial = escHtml((m.nickname || m.uid || '?')[0].toUpperCase());
        const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
        const count = Object.values(votes).filter(v => v === m.uid).length;
        const pct = Math.round((count / total) * 100);
        const isMyVote = myVote === m.uid;
        const isPet = m.uid === petTargetUid;
        return `<div class="pv-member-card">
            <div class="pv-member-av" style="background:${color};">${initial}</div>
            <p class="pv-member-name">${name}${isPet ? ' 🐾' : ''}</p>
            <div class="pv-vote-bar"><div class="pv-vote-fill" style="width:${pct}%"></div></div>
            <p class="pv-vote-count">${count} 票</p>
            <button class="pv-vote-btn${isMyVote ? ' voted' : ''}" data-uid="${escHtml(m.uid)}">${isMyVote ? '已投票' : '投票'}</button>
        </div>`;
    }).join('');

    grid.querySelectorAll('.pv-vote-btn').forEach(btn => {
        btn.onclick = () => handleVote(btn.dataset.uid);
    });
}

async function handleVote(targetUid) {
    if (!currentGroupId) return;
    try {
        const { voteForPet } = await import('../../features/groups/controller.js?v=39');
        const { data } = await voteForPet(currentGroupId, targetUid);
        if (data?.status === 'success') {
            const { fetchGroupDetail } = await import('../../features/groups/controller.js?v=39');
            const full = await fetchGroupDetail(currentGroupId);
            if (full) { state.currentGroupDetail = { ...state.currentGroupDetail, ...full }; renderMembers(full); }
        } else {
            alert(t('投票失敗') + (data?.detail ? ': ' + data.detail : ''));
        }
    } catch (err) {
        alert(t('投票失敗：') + (err.message || err));
    }
}

// ── ② 選身體造型 ──
function buildBodyGrid() {
    const grid = document.getElementById('pv-body-grid');
    if (!grid) return;
    grid.innerHTML = PET_BODY_OPTIONS.map(emoji => {
        const active = emoji === selectedBody ? ' active' : '';
        return `<button class="pv-animal-card${active}" data-emoji="${emoji}"><span>${emoji}</span><p>${BODY_LABELS[emoji] || ''}</p></button>`;
    }).join('');
    grid.querySelectorAll('.pv-animal-card').forEach(btn => {
        btn.onclick = () => {
            selectedBody = btn.dataset.emoji;
            grid.querySelectorAll('.pv-animal-card').forEach(b => b.classList.toggle('active', b === btn));
        };
    });
}

// ── 確認 → 存身體造型 → 生成寵物臉 ──
async function handleConfirm() {
    if (!currentGroupId) return;
    if (!selectedBody) { alert(t('請選擇一個動物身體')); return; }

    const btn = document.getElementById('btn-pet-vote-confirm');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = t('儲存中…');
    try {
        const { updatePet } = await import('../../features/groups/controller.js?v=39');
        const { data } = await updatePet(currentGroupId, { pet_body_emoji: selectedBody });
        if (data?.status !== 'success') {
            alert(t('更新失敗：') + (data?.detail || JSON.stringify(data)));
            return;
        }
        // 讓下一頁立即套用剛選的身體，不等下次向後端重新載入。
        state.currentGroupDetail = {
            ...state.currentGroupDetail,
            pet_body_emoji: selectedBody,
        };
        // 帶入投票最高票者作為要拍攝的臉（pet-swap 用 state.petSwapTarget）
        const g = state.currentGroupDetail;
        const winner = pickWinner(g);
        state.petSwapTarget = winner ? { uid: winner.uid, nickname: winner.nickname } : null;
        switchView('view-pet-swap');
    } catch (err) {
        alert(t('更新失敗：') + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function pickWinner(g) {
    const members = g?.members || [];
    if (g?.pet_target_uid) return members.find(m => m.uid === g.pet_target_uid) || null;
    const votes = g?.pet_votes || {};
    if (!Object.keys(votes).length) return null;
    const tally = {};
    for (const v of Object.values(votes)) tally[v] = (tally[v] || 0) + 1;
    const topUid = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
    return members.find(m => m.uid === topUid) || null;
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
