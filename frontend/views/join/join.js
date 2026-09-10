// views/join/join.js
import { back, register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { getDisplayNickname } from '../../core/firebase.js?v=64';
import { joinRoom } from '../../core/session.js';
import { t } from '../../core/i18n.js';
import { saveLocalGuestNickname } from '../../core/guest.js?v=64';

export function init() {
    register('view-join', { element: document.getElementById('view-join') });
    document.getElementById('btn-confirm-join').onclick = confirmJoinRoom;
    document.getElementById('btn-cancel-join').onclick = () => {
        state.pendingRoomId = null;
        history.replaceState(history.state, '', window.location.pathname);
        back();
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
    // 不自動 focus：避免一進頁面就彈鍵盤。
}

function confirmJoinRoom() {
    const input = document.getElementById('join-nickname');
    const name = (input.value || '').trim();
    if (!name) {
        alert(t('請先輸入暱稱才能加入聚會'));
        input.focus();
        return;
    }
    state.myNickname = name.slice(0, 20);
    if (!state.currentUser) saveLocalGuestNickname(state.myNickname);
    const rid = state.pendingRoomId;
    state.pendingRoomId = null;
    state.amIHost = false;
    joinRoom(rid);
}
