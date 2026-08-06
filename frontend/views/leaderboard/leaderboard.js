// views/leaderboard/leaderboard.js
import { back, register } from '../../core/router.js';
import { switchLeaderboardTab } from '../../features/leaderboard/controller.js';

export function init() {
    register('view-leaderboard', { element: document.getElementById('view-leaderboard') });
    document.getElementById('btn-leaderboard-back').onclick = back;
    document.getElementById('lb-tab-global').onclick = () => switchLeaderboardTab('global');
    document.getElementById('lb-tab-friends').onclick = () => switchLeaderboardTab('friends');
}
