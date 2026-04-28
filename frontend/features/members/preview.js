// features/members/preview.js — 成員資料預覽 modal
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { sendFriendRequestByUid } from '../friends/controller.js';

export async function openMemberPreview(targetUid) {
    if (!state.currentUser) { alert('請先登入才能查看'); return; }
    state.memberPreviewUid = targetUid;
    document.getElementById('member-preview-nickname').innerText = '載入中...';
    document.getElementById('member-preview-bio').innerText = '';
    document.getElementById('member-preview-avatar').src = '';
    const btnAdd = document.getElementById('btn-member-preview-add');
    btnAdd.style.display = 'none';
    const modal = document.getElementById('view-member-preview');
    if (modal) modal.classList.remove('hidden');
    try {
        const { res, data } = await apiFetch(`/api/users/${encodeURIComponent(targetUid)}/public`);
        if (!res.ok) { alert('讀取資料失敗:' + ((data && data.detail) || '')); return; }
        const p = (data && data.profile) || {};
        document.getElementById('member-preview-nickname').innerText = p.nickname || '(無名)';
        document.getElementById('member-preview-bio').innerText = p.bio || '(這個人還沒寫 bio)';
        if (p.photoURL) document.getElementById('member-preview-avatar').src = p.photoURL;
    } catch (err) {
        document.getElementById('member-preview-nickname').innerText = '載入失敗';
        console.error(err);
    }
    updateMemberPreviewAddBtn();
}

export function updateMemberPreviewAddBtn() {
    const btn = document.getElementById('btn-member-preview-add');
    if (!btn) return;
    if (!state.memberPreviewUid || !state.currentUser) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.disabled = false;
    btn.className = 'btn primary';
    if (state.friendUidSet.has(state.memberPreviewUid)) {
        btn.innerText = '✓ 已是好友';
        btn.disabled = true;
    } else if (state.outgoingPendingSet.has(state.memberPreviewUid)) {
        btn.innerText = '等待回覆中';
        btn.disabled = true;
    } else if (state.incomingPendingSet.has(state.memberPreviewUid)) {
        btn.innerText = '對方已邀請你,去處理';
        btn.onclick = () => import('../../views/friends/friends.js').then(m => m.openFriendsView('incoming'));
        return;
    } else {
        btn.innerText = '➕ 加好友';
        btn.onclick = () => sendFriendRequestByUid(state.memberPreviewUid, btn);
    }
}

export function closeMemberPreview() {
    state.memberPreviewUid = null;
    const modal = document.getElementById('view-member-preview');
    if (modal) modal.classList.add('hidden');
}
