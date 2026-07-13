// views/friend-profile/friend-profile.js — 好友/陌生人資料卡（front-preview screen-friend-profile + friend-scan-result 合併）
// 依 relationship 自適應：好友→統計+刪除；陌生人→共同好友+加好友。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { events } from '../../core/events.js';
import { showToast } from '../../utils/toast.js';
import { sendFriendRequestByUid } from '../../features/friends/controller.js';

let currentUid = null;

export function init() {
    register('view-friend-profile', {
        element: document.getElementById('view-friend-profile'),
        onShow,
    });
    document.getElementById('btn-fp-back').onclick = () => switchView('view-friends');
    document.getElementById('fp-add-btn').onclick = handleAdd;
    document.getElementById('fp-delete-btn').onclick = () => toggleConfirm(true);
    document.getElementById('fp-cancel-btn').onclick = () => toggleConfirm(false);
    document.getElementById('fp-confirm-delete').onclick = handleDelete;
}

async function onShow() {
    currentUid = state.friendProfileUid;
    if (!currentUid) { switchView('view-friends'); return; }
    resetFooter();
    setText('fp-name', '—'); setText('fp-id', ''); setText('fp-stat-meetings', '0');
    setText('fp-stat-friends', '0'); setText('fp-stat-score', '0');
    try {
        const { res, data } = await apiFetch(`/api/users/${encodeURIComponent(currentUid)}/card`);
        if (!res.ok || !data?.profile) { showToast(t('讀取資料失敗'), 'error'); return; }
        render(data);
    } catch (err) {
        showToast(t('讀取資料失敗：') + (err.message || err), 'error');
    }
}

function render(data) {
    const p = data.profile || {};
    const stats = data.stats || {};
    setText('fp-name', p.nickname || p.handle || currentUid);
    setText('fp-id', p.handle ? '@' + p.handle : '');
    const bio = document.getElementById('fp-bio');
    if (p.bio) { bio.textContent = p.bio; bio.style.display = ''; } else { bio.style.display = 'none'; }

    const av = document.getElementById('fp-avatar');
    if (p.photoURL) { av.innerHTML = `<img src="${escAttr(p.photoURL)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`; av.style.background = 'transparent'; }
    else { av.textContent = (p.nickname || p.handle || '?')[0].toUpperCase(); }

    setText('fp-stat-meetings', stats.meetings_count ?? 0);
    setText('fp-stat-friends', stats.friends_count ?? 0);
    setText('fp-stat-score', stats.weekly_score ?? 0);

    // 共同好友
    const mutual = document.getElementById('fp-mutual');
    const mc = data.mutual_friends_count || 0;
    if (mc > 0 && data.relationship !== 'friend') {
        mutual.textContent = t('與你有 {count} 位共同好友', { count: mc });
        mutual.style.display = 'block';
    } else {
        mutual.style.display = 'none';
    }

    applyRelationship(data.relationship);
}

function applyRelationship(rel) {
    resetFooter();
    if (rel === 'friend') {
        document.getElementById('fp-delete-area').style.display = 'block';
    } else if (rel === 'outgoing_pending') {
        document.getElementById('fp-pending-hint').style.display = 'block';
    } else if (rel === 'self') {
        // 自己：什麼都不顯示
    } else {
        // none / incoming_pending → 可加好友（送出時後端會 auto-accept incoming）
        document.getElementById('fp-add-btn').style.display = 'block';
    }
}

function resetFooter() {
    ['fp-add-btn', 'fp-pending-hint', 'fp-delete-area', 'fp-confirm-area'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
}

function toggleConfirm(show) {
    document.getElementById('fp-delete-area').style.display = show ? 'none' : 'block';
    document.getElementById('fp-confirm-area').style.display = show ? 'block' : 'none';
}

async function handleAdd() {
    const btn = document.getElementById('fp-add-btn');
    await sendFriendRequestByUid(currentUid, btn);
    // 送出後刷新關係狀態
    onShow();
}

async function handleDelete() {
    // 內嵌確認已在畫面上，直接刪除（不走 controller 的 confirm 以免二次確認）
    try {
        const { res, data } = await apiFetch(`/api/friends/${encodeURIComponent(currentUid)}`, { method: 'DELETE' });
        if (!res.ok) { showToast(t('刪除失敗：') + ((data && data.detail) || res.status), 'error'); return; }
        state.friendUidSet?.delete?.(currentUid);
        events.emit('friends:changed');
        showToast(t('已刪除好友'), 'success');
        switchView('view-friends');
    } catch (err) {
        showToast(t('刪除失敗：') + (err.message || err), 'error');
    }
}

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function escAttr(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
