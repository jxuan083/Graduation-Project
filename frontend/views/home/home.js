// views/home/home.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { events } from '../../core/events.js';
import { startQrScanner } from '../scanner/scanner.js';
import { openMeetingsList } from '../../features/meetings/controller.js';
import { openQuestionBank } from '../question-bank/question-bank.js';
import { openFriendsView } from '../friends/friends.js';
import { openLeaderboardView } from '../../features/leaderboard/controller.js';

export function init() {
    register('view-home', {
        element: document.getElementById('view-home'),
        onShow: () => events.emit('home:show')
    });

    document.getElementById('btn-create-room').onclick = handleCreateRoom;
    document.getElementById('btn-scan-qr').onclick = startQrScanner;
    document.getElementById('btn-open-meetings').onclick = openMeetingsList;
    document.getElementById('btn-open-questions').onclick = openQuestionBank;

    const btnGroups = document.getElementById('btn-open-groups');
    if (btnGroups) btnGroups.onclick = () => switchView('view-groups');

    const btnLb = document.getElementById('btn-home-leaderboard');
    if (btnLb) btnLb.onclick = openLeaderboardView;


    // 邀請橫幅「查看」按鈕
    const btnBannerView = document.getElementById('btn-incoming-banner-view');
    if (btnBannerView) btnBannerView.onclick = () => openFriendsView('incoming');
}

function handleCreateRoom() {
    if (!state.currentUser) {
        alert('請先用 Google 登入才能發起聚會');
        return;
    }
    switchView('view-meeting-setup');
}
