// views/group/group.js — 群組詳情頁（front-preview screen-group）
// 中樞頁：成員、群組寵物（空/有）、最近聚會；再導向設定/聊天/邀請/寵物養成。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { formatModeLabel } from '../../utils/format.js';
import { showToast } from '../../utils/toast.js';

const AVATAR_COLORS = ['#a8c8e8', '#f5c6b8', '#b8e4c6', '#f5e4a8', '#d8b8e8', '#e8c8a8', '#c8d8e8'];

export function init() {
    register('view-group', {
        element: document.getElementById('view-group'),
        onShow: onShow,
    });

    document.getElementById('btn-group-back').onclick = () => switchView('view-home');

    document.getElementById('btn-group-settings').onclick = () => {
        if (state.currentGroupDetail) switchView('view-group-setup');
    };

    // 群組聊天室
    document.getElementById('btn-group-chat').onclick = () => {
        if (state.currentGroupDetail) switchView('view-group-chat');
    };

    // 寵物投票 / 更新寵物 → 獨立寵物投票頁
    document.getElementById('btn-group-pet-vote').onclick = () => {
        if (state.currentGroupDetail) switchView('view-pet-vote');
    };
    document.getElementById('btn-group-pet-regen').onclick = () => {
        if (state.currentGroupDetail) switchView('view-pet-vote');
    };

    document.getElementById('btn-group-pet-tama').onclick = () => {
        state.tamagotchiGroupId = state.currentGroupDetail?.group_id || null;
        switchView('view-pet-tamagotchi');
    };

    document.getElementById('btn-group-all-meetings').onclick = async () => {
        const { openMeetingsList } = await import('../../features/meetings/controller.js');
        openMeetingsList();
    };
}

async function onShow() {
    const g = state.currentGroupDetail;
    if (!g) { switchView('view-home'); return; }

    // 先用手上的基本資料畫，再抓完整詳情
    document.getElementById('group-title').textContent = g.name || t('群組');
    renderMembers(g);
    renderPet(g);
    renderMeetings(g.group_id);

    try {
        const { fetchGroupDetail } = await import('../../features/groups/controller.js');
        const full = await fetchGroupDetail(g.group_id);
        if (full) {
            state.currentGroupDetail = { ...g, ...full };
            document.getElementById('group-title').textContent = full.name || g.name || t('群組');
            renderMembers(full);
            renderPet(full);
        }
    } catch (err) {
        console.warn('[group] fetchGroupDetail failed:', err);
    }
    if (window.lucide) window.lucide.createIcons();
}

function renderMembers(g) {
    const row = document.getElementById('group-members-row');
    const countEl = document.getElementById('grp-detail-member-count');
    const members = g.members || [];
    // /api/groups 列表項沒有 members[]/member_count，但有 member_uids；群組詳情才有 members[]
    countEl.textContent = members.length || g.member_count || (g.member_uids?.length ?? 0);
    if (!row) return;

    const cells = members.map((m, i) => {
        const name = m.nickname || m.uid || '';
        const initial = escHtml((name[0] || '?').toUpperCase());
        const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
        const isCreator = m.uid === g.creator_uid;
        const photo = m.photoURL || '';
        const av = photo
            ? `<div class="grp-member-av" style="overflow:hidden;"><img src="${escHtml(photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
            : `<div class="grp-member-av" style="background:${color};">${initial}</div>`;
        return `<div class="grp-member-item">
            ${av}
            <span class="grp-member-name">${escHtml(name)}</span>
            ${isCreator ? '<span class="grp-host-badge">房主</span>' : ''}
        </div>`;
    }).join('');

    row.innerHTML = cells +
        `<button class="grp-invite-member-btn" id="btn-group-invite">＋ 邀請</button>`;

    const inviteBtn = document.getElementById('btn-group-invite');
    if (inviteBtn) inviteBtn.onclick = () => { if (state.currentGroupDetail) switchView('view-group-invite'); };
}

async function renderMeetings(groupId) {
    const listEl = document.getElementById('group-meetings-list');
    const emptyEl = document.getElementById('group-meetings-empty');
    if (!listEl || !groupId) return;
    listEl.innerHTML = '';
    try {
        const { res, data } = await apiFetch(`/api/groups/${encodeURIComponent(groupId)}/meetings?limit=5`);
        const meetings = (res.ok && data?.meetings) || [];
        if (!meetings.length) {
            emptyEl.style.display = '';
            return;
        }
        emptyEl.style.display = 'none';
        listEl.innerHTML = meetings.map(m => {
            const date = fmtMeetingDate(m.ended_at);
            const mode = escHtml(t(formatModeLabel(m.mode)));
            return `<button class="grp-meeting-item" data-id="${escHtml(m.id)}">
                <div class="grp-meeting-info">
                    <p class="grp-meeting-mode">${mode}</p>
                    <p class="grp-meeting-meta">${escHtml(String(m.member_count || 0))} 人 · ${escHtml(String(m.duration_minutes || 0))} 分鐘 · ${escHtml(date)}</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 26 14.73" fill="none" style="transform:rotate(180deg);flex-shrink:0;"><path d="M25 7.36H1M1 7.36L8 1M1 7.36L8 13.73" stroke="var(--brown)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>`;
        }).join('');
        listEl.querySelectorAll('.grp-meeting-item').forEach(btn => {
            btn.onclick = async () => {
                const { openMeetingDetail } = await import('../../features/meetings/controller.js');
                openMeetingDetail(btn.dataset.id);
            };
        });
    } catch (err) {
        console.warn('[group] renderMeetings failed:', err);
        emptyEl.style.display = '';
    }
}

function fmtMeetingDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

function renderPet(g) {
    const empty = document.getElementById('group-pet-empty');
    const has = document.getElementById('group-pet-has');
    const hasPet = !!g.pet_target_uid;

    empty.style.display = hasPet ? 'none' : '';
    has.style.display = hasPet ? '' : 'none';
    if (!hasPet) return;

    document.getElementById('group-pet-name').textContent = g.pet_name || t('群組寵物');
    const img = document.getElementById('group-pet-img');
    if (g.pet_face_url) { img.src = g.pet_face_url; img.style.display = ''; }
    else { img.style.display = 'none'; }

    // HP 愛心（滿 5 顆）
    const hp = Math.max(0, Math.min(5, g.pet_hp ?? 0));
    const hpEl = document.getElementById('group-pet-hp');
    hpEl.innerHTML = Array.from({ length: 5 }, (_, i) =>
        `<span class="grp-pet-heart${i < hp ? '' : ' grp-pet-heart-empty'}">${i < hp ? '❤️' : '🤍'}</span>`
    ).join('');

    // 能量
    const energy = g.pet_energy ?? 0;
    const maxE = g.pet_max_energy ?? 100;
    const pct = maxE > 0 ? Math.round((energy / maxE) * 100) : 0;
    document.getElementById('group-pet-energy-fill').style.width = `${pct}%`;
    document.getElementById('group-pet-energy-val').textContent = energy;
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
