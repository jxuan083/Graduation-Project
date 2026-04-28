// features/friends/controller.js — 好友 cache、邀請、接受/拒絕
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { showToast } from '../../utils/toast.js';
import { events } from '../../core/events.js';

// === Cache 載入 ===
export async function loadFriendUidCache() {
    if (!state.currentUser) { state.friendUidSet = new Set(); return; }
    try {
        const { data } = await apiFetch('/api/friends');
        state.friendUidSet = new Set(((data && data.friends) || []).map(f => f.uid));
    } catch (err) {
        console.warn('load friend uid cache failed:', err);
    }
}

export async function loadFriendRequestsCache() {
    if (!state.currentUser) {
        state.outgoingPendingSet = new Set();
        state.incomingPendingSet = new Set();
        return;
    }
    try {
        const { data } = await apiFetch('/api/friend_requests');
        state.outgoingPendingSet = new Set(((data && data.outgoing) || []).map(r => r.other_uid));
        state.incomingPendingSet = new Set(((data && data.incoming) || []).map(r => r.other_uid));
    } catch (err) {
        console.warn('load friend requests cache failed:', err);
    }
}

// === 加好友 (by email or uid) ===
export async function sendFriendRequestByUid(targetUid, btnEl) {
    if (!state.currentUser) { alert('請先登入'); return; }
    const originalText = btnEl ? btnEl.innerText : '';
    if (btnEl) { btnEl.innerText = '送出中...'; btnEl.disabled = true; }
    try {
        const { res, data } = await apiFetch('/api/friend_requests', {
            method: 'POST',
            body: JSON.stringify({ target_uid: targetUid })
        });
        if (!res.ok) {
            alert('送出邀請失敗:' + ((data && data.detail) || res.status));
            if (btnEl) { btnEl.innerText = originalText; btnEl.disabled = false; }
            return;
        }
        if (data.status === 'auto_accepted') {
            state.friendUidSet.add(targetUid);
            state.outgoingPendingSet.delete(targetUid);
            state.incomingPendingSet.delete(targetUid);
            if (btnEl) {
                btnEl.innerText = '✓ 已是好友';
                btnEl.disabled = true;
                btnEl.classList.remove('pending');
                btnEl.classList.add('done');
            }
            showToast(data.message || '🎉 對方也邀請了你,你們已成為好友!');
            events.emit('friends:auto-accepted', { uid: targetUid });
        } else {
            state.outgoingPendingSet.add(targetUid);
            if (btnEl) {
                btnEl.innerText = '等待回覆中';
                btnEl.disabled = true;
                btnEl.classList.add('pending');
            }
        }
        events.emit('friends:changed');
    } catch (err) {
        alert('網路錯誤:' + err.message);
        if (btnEl) { btnEl.innerText = originalText; btnEl.disabled = false; }
    }
}

export async function acceptFriendRequest(reqId) {
    try {
        const { res, data } = await apiFetch(`/api/friend_requests/${encodeURIComponent(reqId)}/accept`, {
            method: 'POST'
        });
        if (!res.ok) { alert('接受失敗:' + ((data && data.detail) || '')); return; }
        showToast('🎉 已接受好友邀請');
        events.emit('friends:changed');
    } catch (err) { alert('網路錯誤:' + err.message); }
}

export async function declineFriendRequest(reqId) {
    try {
        const { res, data } = await apiFetch(`/api/friend_requests/${encodeURIComponent(reqId)}/decline`, {
            method: 'POST'
        });
        if (!res.ok) { alert('拒絕失敗:' + ((data && data.detail) || '')); return; }
        events.emit('friends:changed');
    } catch (err) { alert('網路錯誤:' + err.message); }
}

export async function removeFriend(friendUid) {
    if (!confirm('確定要解除好友關係嗎?')) return;
    try {
        const { res, data } = await apiFetch(`/api/friends/${encodeURIComponent(friendUid)}`, {
            method: 'DELETE'
        });
        if (!res.ok) { alert('解除失敗:' + ((data && data.detail) || '')); return; }
        state.friendUidSet.delete(friendUid);
        events.emit('friends:changed');
    } catch (err) { alert('網路錯誤:' + err.message); }
}
