// views/leaderboard/leaderboard.js
import { register } from '../../core/router.js';
import { goHomeFromMenu } from '../../core/session.js';
import { switchLeaderboardTab } from '../../features/leaderboard/controller.js';

export function init() {
    register('view-leaderboard', { element: document.getElementById('view-leaderboard') });
    document.getElementById('btn-leaderboard-back').onclick = goHomeFromMenu;
    document.getElementById('lb-tab-global').onclick = () => switchLeaderboardTab('global');
    document.getElementById('lb-tab-friends').onclick = () => switchLeaderboardTab('friends');
}
