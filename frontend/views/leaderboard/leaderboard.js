// views/leaderboard/leaderboard.js
import { back, register, switchView } from '../../core/router.js';
import { switchLeaderboardTab } from '../../features/leaderboard/controller.js';
import { state } from '../../core/state.js';

export function init() {
    register('view-leaderboard', { element: document.getElementById('view-leaderboard') });
    document.getElementById('btn-leaderboard-back').onclick = back;
    document.getElementById('lb-tab-global').onclick = () => switchLeaderboardTab('global');
    document.getElementById('lb-tab-friends').onclick = () => switchLeaderboardTab('friends');
    document.getElementById('btn-lb-open-gacha').onclick = () => {
        state.openGachaAfterLoad = true;
        switchView('view-pet-tamagotchi');
    };
}
