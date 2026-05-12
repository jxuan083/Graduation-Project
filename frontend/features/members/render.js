// features/members/render.js — 渲染成員清單 (host-room / waiting-room / focus 共用)
import { state } from '../../core/state.js';
import { sendFriendRequestByUid } from '../friends/controller.js';
import { openMemberPreview } from './preview.js';
import { switchView } from '../../core/router.js';

export function renderMemberList(members) {
    const entries = Object.entries(members || {});
    const renderTo = (ulEl, countEl) => {
        if (!ulEl) return;
        ulEl.innerHTML = '';
        entries.forEach(([uid, info]) => {
            const li = document.createElement('li');
            li.className = 'member-row';

            const nameWrap = document.createElement('div');
            nameWrap.className = 'member-name-wrap';
            const nameSpan = document.createElement('span');
            nameSpan.innerText = (info && info.nickname) ? info.nickname : '(無名)';
            nameWrap.appendChild(nameSpan);

            const isHost = state.roomHostUid && uid === state.roomHostUid;
            const isMe = uid === state.userId;
            const isGuest = typeof uid === 'string' && uid.includes('-');

            if (isHost) {
                const tag = document.createElement('span');
                tag.className = 'member-tag host';
                tag.innerText = isMe ? '(房主・你)' : '(房主)';
                nameWrap.appendChild(tag);
            } else if (isMe) {
                const tag = document.createElement('span');
                tag.className = 'member-tag you';
                tag.innerText = '(你)';
                nameWrap.appendChild(tag);
            } else if (isGuest) {
                const tag = document.createElement('span');
                tag.className = 'member-tag guest';
                tag.innerText = '(訪客)';
                nameWrap.appendChild(tag);
            }
            li.appendChild(nameWrap);

            // 對「其他已登入使用者」顯示查看/加好友按鈕
            if (!isMe && !isGuest && state.currentUser) {
                const actions = document.createElement('div');
                actions.className = 'member-actions';

                const btnView = document.createElement('button');
                btnView.className = 'member-action-btn';
                btnView.innerText = '👤 查看';
                btnView.onclick = (e) => { e.stopPropagation(); openMemberPreview(uid); };
                actions.appendChild(btnView);

                const btnFriend = document.createElement('button');
                btnFriend.className = 'member-action-btn add';
                if (state.friendUidSet.has(uid)) {
                    btnFriend.innerText = '✓ 已是好友';
                    btnFriend.disabled = true;
                    btnFriend.classList.add('done');
                } else if (state.outgoingPendingSet.has(uid)) {
                    btnFriend.innerText = '等待回覆中';
                    btnFriend.disabled = true;
                    btnFriend.classList.add('pending');
                } else if (state.incomingPendingSet.has(uid)) {
                    btnFriend.innerText = '前往處理邀請';
                    btnFriend.onclick = (e) => {
                        e.stopPropagation();
                        // 動態 import 避免循環依賴
                        import('../../views/friends/friends.js').then(m => m.openFriendsView('incoming'));
                    };
                } else {
                    btnFriend.innerText = '➕ 加好友';
                    btnFriend.onclick = (e) => {
                        e.stopPropagation();
                        sendFriendRequestByUid(uid, btnFriend);
                    };
                }
                actions.appendChild(btnFriend);

                li.appendChild(actions);
            }

            ulEl.appendChild(li);
        });
        if (countEl) countEl.innerText = entries.length;
    };

    renderTo(document.getElementById('member-list-ul'),
             document.getElementById('member-count'));
    renderTo(document.getElementById('waiting-member-list-ul'),
             document.getElementById('waiting-member-count'));
    renderTo(document.getElementById('focus-member-list-ul'),
             document.getElementById('focus-member-count'));
}
