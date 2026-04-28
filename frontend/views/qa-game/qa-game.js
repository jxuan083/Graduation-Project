// views/qa-game/qa-game.js — 團體問答遊戲畫面
import { register } from '../../core/router.js';

export function init() {
    register('view-qa-game', { element: document.getElementById('view-qa-game') });
    // QA 流程的所有 UI 更新都在 ws handler (見 main.js / wsHandlers)
}
