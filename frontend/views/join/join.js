// views/join/join.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { getDisplayNickname } from '../../core/firebase.js';
import { joinRoom } from '../../core/session.js';

export function init() {
    register('view-join', { element: document.getElementById('view-join') });
    document.getElementById('btn-confirm-join').onclick = confirmJoinRoom;
    document.getElementById('btn-cancel-join').onclick = () => {
        state.pendingRoomId = null;
        history.replaceState(null, '', window.location.pathname);
        switchView('view-home');
    };
}

export function showJoinView() {
    const input = document.getElementById('join-nickname');
    const hint = document.getElementById('join-login-hint');
    const nick = getDisplayNickname();
    if (nick) {
        input.value = nick;
        hint.style.display = 'none';
    } else {
        input.value = '';
        hint.style.display = 'block';
    }
    switchView('view-join');
    setTimeout(() => input.focus(), 100);
}

function confirmJoinRoom() {
    const input = document.getElementById('join-nickname');
    const name = (input.value || '').trim();
    if (!name) {
        alert('請先輸入暱稱才能加入聚會');
        input.focus();
        return;
    }
    state.myNickname = name.slice(0, 20);
    const rid = state.pendingRoomId;
    state.pendingRoomId = null;
    state.amIHost = false;
    joinRoom(rid);
}
