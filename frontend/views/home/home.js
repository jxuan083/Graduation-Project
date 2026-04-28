// views/home/home.js
import { register } from '../../core/router.js';
import { state } from '../../core/state.js';
import { events } from '../../core/events.js';
import { getDisplayNickname, getAuthHeaders, doSignOut } from '../../core/firebase.js';
import { joinRoom } from '../../core/session.js';
import { apiBase } from '../../core/api.js';
import { startQrScanner } from '../scanner/scanner.js';
import { openMeetingsList } from '../../features/meetings/controller.js';
import { openQuestionBank } from '../question-bank/question-bank.js';
import { openFriendsView } from '../friends/friends.js';

export function init() {
    register('view-home', {
        element: document.getElementById('view-home'),
        onShow: () => events.emit('home:show')
    });

    document.getElementById('btn-create-room').onclick = handleCreateRoom;
    document.getElementById('btn-scan-qr').onclick = startQrScanner;
    document.getElementById('btn-open-meetings').onclick = openMeetingsList;
    document.getElementById('btn-open-questions').onclick = openQuestionBank;

    // 邀請橫幅「查看」按鈕
    const btnBannerView = document.getElementById('btn-incoming-banner-view');
    if (btnBannerView) btnBannerView.onclick = () => openFriendsView('incoming');
}

async function handleCreateRoom() {
    if (!state.currentUser) {
        alert('請先用 Google 登入才能發起聚會');
        return;
    }
    state.amIHost = true;
    state.myNickname = getDisplayNickname() || '房主';

    const frontendUrl = window.location.protocol + "//" + window.location.host;
    try {
        const res = await fetch(
            `${apiBase}/api/create_room?frontend_url=${encodeURIComponent(frontendUrl)}`,
            { mode: 'cors', headers: await getAuthHeaders() }
        );
        if (res.status === 401) {
            alert('登入狀態失效,請重新登入');
            await doSignOut();
            return;
        }
        const data = await res.json();
        document.getElementById('qr-code-img').src = 'data:image/png;base64,' + data.qr_base64;
        joinRoom(data.room_id);
    } catch (err) {
        console.error('create_room failed:', err);
        alert('建立房間失敗:' + (err.message || err));
        state.amIHost = false;
    }
}
