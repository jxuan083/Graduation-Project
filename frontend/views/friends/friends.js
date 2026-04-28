// views/friends/friends.js — 好友頁
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { goHomeFromMenu } from '../../core/session.js';
import { events } from '../../core/events.js';
import {
    sendFriendRequestByUid,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    loadFriendUidCache,
    loadFriendRequestsCache,
} from '../../features/friends/controller.js';

const FRIEND_TABS = ['list', 'incoming', 'add'];

export function init() {
    register('view-friends', { element: document.getElementById('view-friends') });

    document.getElementById('btn-friends-back').onclick = goHomeFromMenu;
    document.getElementById('friends-tab-list').onclick = () => { switchFriendTab('list'); refreshFriends(); };
    document.getElementById('friends-tab-incoming').onclick = () => { switchFriendTab('incoming'); refreshFriendRequests(); };
    document.getElementById('friends-tab-add').onclick = () => { switchFriendTab('add'); refreshFriendRequests(); };
    document.getElementById('btn-send-friend-req').onclick = sendFriendRequestByEmail;

    // 好友狀態變動時自動重整
    events.on('friends:changed', () => {
        if (document.getElementById('view-friends').classList.contains('active')) {
            refreshFriends();
            refreshFriendRequests();
        }
    });
}

export function openFriendsView(initialTab) {
    if (!state.currentUser) { alert('請先登入'); return; }
    switchView('view-friends');
    const tab = FRIEND_TABS.includes(initialTab) ? initialTab : 'list';
    switchFriendTab(tab);
    refreshFriends();
    refreshFriendRequests();
}

function switchFriendTab(tab) {
    document.getElementById('friends-tab-list').classList.toggle('active', tab === 'list');
    document.getElementById('friends-tab-incoming').classList.toggle('active', tab === 'incoming');
    document.getElementById('friends-tab-add').classList.toggle('active', tab === 'add');
    document.getElementById('friends-list-pane').style.display = (tab === 'list') ? 'block' : 'none';
    document.getElementById('friends-incoming-pane').style.display = (tab === 'incoming') ? 'block' : 'none';
    document.getElementById('friends-add-pane').style.display = (tab === 'add') ? 'block' : 'none';
}

async function refreshFriends() {
    if (!state.currentUser) return;
    const listEl = document.getElementById('friends-list');
    const emptyHint = document.getElementById('friends-empty-hint');
    listEl.innerHTML = '載入中...';
    try {
        const { data } = await apiFetch('/api/friends');
        const friends = (data && data.friends) || [];
        state.friendUidSet = new Set(friends.map(f => f.uid));
        document.getElementById('friends-count').innerText = friends.length;
        listEl.innerHTML = '';
        if (friends.length === 0) {
            emptyHint.style.display = 'block';
        } else {
            emptyHint.style.display = 'none';
            friends.forEach(f => listEl.appendChild(buildFriendCard(f, 'friend')));
        }
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<p class="hint">讀取好友列表失敗</p>';
    }
}

async function refreshFriendRequests() {
    if (!state.currentUser) return;
    const inEl = document.getElementById('friends-incoming-list');
    const inEmpty = document.getElementById('friends-incoming-empty');
    const outEl = document.getElementById('friends-outgoing-list');
    inEl.innerHTML = '載入中...';
    outEl.innerHTML = '';
    try {
        const { data } = await apiFetch('/api/friend_requests');
        const incoming = (data && data.incoming) || [];
        const outgoing = (data && data.outgoing) || [];
        state.outgoingPendingSet = new Set(outgoing.map(r => r.other_uid));
        state.incomingPendingSet = new Set(incoming.map(r => r.other_uid));
        document.getElementById('friends-incoming-count').innerText = incoming.length;
        inEl.innerHTML = '';
        if (incoming.length === 0) {
            inEmpty.style.display = 'block';
        } else {
            inEmpty.style.display = 'none';
            incoming.forEach(r => inEl.appendChild(buildFriendCard(r, 'incoming')));
        }
        outgoing.forEach(r => outEl.appendChild(buildFriendCard(r, 'outgoing')));
    } catch (err) {
        console.error(err);
        inEl.innerHTML = '<p class="hint">讀取邀請失敗</p>';
    }
}

function buildFriendCard(item, kind) {
    const card = document.createElement('div');
    card.className = 'friend-card';

    const avatar = document.createElement('img');
    avatar.className = 'friend-avatar';
    const avatarUrl = (kind === 'friend' ? item.avatar_snapshot : item.other_avatar) || '';
    // 🔒 [Bug 7 修正 v15.3] src='' 會讓瀏覽器把當前頁當圖片抓 → 用透明 1x1 placeholder
    avatar.src = avatarUrl || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    avatar.alt = 'avatar';
    avatar.onerror = () => { avatar.style.visibility = 'hidden'; };
    card.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'friend-info';
    const name = document.createElement('div');
    name.className = 'friend-name';
    name.innerText = (kind === 'friend' ? item.nickname_snapshot : item.other_nickname) || '(無名)';
    info.appendChild(name);
    if (kind === 'incoming') {
        const sub = document.createElement('div');
        sub.className = 'friend-sub';
        sub.innerText = '向你發出好友邀請';
        info.appendChild(sub);
    } else if (kind === 'outgoing') {
        const sub = document.createElement('div');
        sub.className = 'friend-sub';
        sub.innerText = '等待對方回覆中';
        info.appendChild(sub);
    }
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'friend-actions';
    if (kind === 'friend') {
        const rm = document.createElement('button');
        rm.className = 'btn-mini danger';
        rm.innerText = '解除';
        rm.onclick = () => removeFriend(item.uid);
        actions.appendChild(rm);
    } else if (kind === 'incoming') {
        const acc = document.createElement('button');
        acc.className = 'btn-mini primary';
        acc.innerText = '接受';
        acc.onclick = () => acceptFriendRequest(item.id);
        actions.appendChild(acc);
        const dec = document.createElement('button');
        dec.className = 'btn-mini';
        dec.innerText = '拒絕';
        dec.onclick = () => declineFriendRequest(item.id);
        actions.appendChild(dec);
    }
    card.appendChild(actions);
    return card;
}

async function sendFriendRequestByEmail() {
    const emailInput = document.getElementById('friends-add-email');
    const msgEl = document.getElementById('friends-add-msg');
    const email = (emailInput.value || '').trim();
    if (!email) { msgEl.innerText = '請輸入 email'; msgEl.className = 'hint error'; return; }
    msgEl.innerText = '送出中...';
    msgEl.className = 'hint';
    try {
        const { res, data } = await apiFetch('/api/friend_requests', {
            method: 'POST',
            body: JSON.stringify({ target_email: email })
        });
        if (!res.ok) {
            msgEl.innerText = '❌ ' + ((data && data.detail) || '送出失敗');
            msgEl.className = 'hint error';
            return;
        }
        if (data.status === 'auto_accepted') {
            msgEl.innerText = '🎉 ' + (data.message || '對方也邀請了你,你們已成為好友!');
            msgEl.className = 'hint ok';
            if (data.target_uid) {
                state.friendUidSet.add(data.target_uid);
                state.outgoingPendingSet.delete(data.target_uid);
                state.incomingPendingSet.delete(data.target_uid);
            }
            refreshFriends();
        } else {
            msgEl.innerText = '✅ 已送出邀請';
            msgEl.className = 'hint ok';
        }
        emailInput.value = '';
        refreshFriendRequests();
    } catch (err) {
        msgEl.innerText = '❌ ' + err.message;
        msgEl.className = 'hint error';
    }
}
