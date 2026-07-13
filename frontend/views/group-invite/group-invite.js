// views/group-invite/group-invite.js — 邀請成員（front-preview screen-group-invite）
// 邀請碼（複製連結）+ 直接邀請好友（加入群組，接現有後端）。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { t } from '../../core/i18n.js';

export function init() {
    register('view-group-invite', {
        element: document.getElementById('view-group-invite'),
        onShow,
    });

    document.getElementById('btn-group-invite-back').onclick = () => switchView('view-group');
    document.getElementById('gi-copy-btn').onclick = handleCopyInvite;
}

async function onShow() {
    const g = state.currentGroupDetail;
    if (!g) { switchView('view-home'); return; }
    renderInviteCode(g);
    loadFriends();

    // 確保有最新邀請碼
    try {
        const { fetchGroupDetail } = await import('../../features/groups/controller.js');
        const full = await fetchGroupDetail(g.group_id);
        if (full) { state.currentGroupDetail = { ...g, ...full }; renderInviteCode(state.currentGroupDetail); }
    } catch (_) { /* 保留現有顯示 */ }
}

function renderInviteCode(g) {
    document.getElementById('gi-invite-code').textContent = g.invite_code || '—';
}

async function handleCopyInvite() {
    const code = state.currentGroupDetail?.invite_code;
    if (!code) { alert(t('邀請碼尚未生成，請稍後再試')); return; }
    const link = `${window.location.protocol}//${window.location.host}/?group_invite=${code}`;
    const btn = document.getElementById('gi-copy-btn');
    try {
        await navigator.clipboard.writeText(link);
        btn.textContent = t('已複製');
        setTimeout(() => { btn.textContent = t('複製'); }, 2000);
    } catch {
        prompt(t('複製此連結：'), link);
    }
}

async function loadFriends() {
    const listEl = document.getElementById('gi-friend-list');
    if (!listEl) return;
    listEl.innerHTML = `<p class="hint">${t('載入好友中…')}</p>`;
    try {
        const { data } = await apiFetch('/api/friends');
        const friends = (data && data.friends) || [];
        const memberUids = new Set((state.currentGroupDetail?.members || []).map(m => m.uid));
        if (!friends.length) {
            listEl.innerHTML = `<p class="hint">${t('還沒有好友，先去加好友吧！')}</p>`;
            return;
        }
        listEl.innerHTML = friends.map(f => {
            const already = memberUids.has(f.uid);
            const rawName = f.nickname_snapshot || f.nickname || f.uid;
            const photo = f.avatar_snapshot || f.avatar_url || f.photoURL;
            const name = escHtml(rawName);
            const avatar = photo
                ? `<div class="friend-avatar" style="width:44px;height:44px;overflow:hidden;flex-shrink:0;"><img src="${escHtml(photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
                : `<div class="friend-avatar" style="width:44px;height:44px;background:var(--brown-10);font-size:20px;flex-shrink:0;">${escHtml((rawName || '?')[0].toUpperCase())}</div>`;
            return `<div class="gi-friend-row">
                ${avatar}
                <div style="flex:1;"><p class="friend-name">${name}</p></div>
                <button class="gi-invite-btn" data-uid="${escHtml(f.uid)}" ${already ? 'data-done="1" disabled' : ''}>${already ? t('已加入') : t('邀請')}</button>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.gi-invite-btn:not([data-done])').forEach(btn => {
            btn.onclick = () => handleInvite(btn);
        });
    } catch (err) {
        listEl.innerHTML = `<p class="hint error">${t('載入好友失敗：')}${err.message || err}</p>`;
    }
}

async function handleInvite(btn) {
    const groupId = state.currentGroupDetail?.group_id;
    if (!groupId) return;
    btn.disabled = true;
    btn.textContent = t('邀請中…');
    try {
        const { addGroupMember } = await import('../../features/groups/controller.js');
        const { data } = await addGroupMember(groupId, btn.dataset.uid);
        if (data?.status === 'success') {
            btn.textContent = t('已加入');
            btn.dataset.done = '1';
        } else {
            btn.disabled = false;
            btn.textContent = t('邀請');
            alert(t('邀請失敗：') + (data?.detail || JSON.stringify(data)));
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = t('邀請');
        alert(t('邀請失敗：') + (err.message || err));
    }
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
