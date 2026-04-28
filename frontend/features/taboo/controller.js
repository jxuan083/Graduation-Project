// features/taboo/controller.js — Taboo Game 邏輯
import { state } from '../../core/state.js';
import { switchView } from '../../core/router.js';
import { sendAction } from '../../core/ws.js';
import { gameLibrary } from './library.js';

// 進入「準備抽卡」畫面 (所有人都會看到)
export function enterTabooPrepare() {
    cleanupTabooLocalState();
    const hostCtrl = document.getElementById('taboo-host-controls');
    if (hostCtrl) hostCtrl.style.display = state.amIHost ? 'block' : 'none';
    switchView('view-taboo-prepare');
}

// 清掉本地倒數 / 字卡狀態
export function cleanupTabooLocalState() {
    if (state.taboo.countdownInterval) {
        clearInterval(state.taboo.countdownInterval);
        state.taboo.countdownInterval = null;
    }
    state.taboo.currentWord = null;
    const wordEl = document.getElementById('taboo-card-word');
    if (wordEl) wordEl.classList.remove('flip');
}

// 從題庫隨機抽一張字卡 (避免連續同一張)
function drawRandomTabooWord() {
    if (!gameLibrary.length) return '???';
    if (gameLibrary.length === 1) return gameLibrary[0];
    let word;
    do {
        word = gameLibrary[Math.floor(Math.random() * gameLibrary.length)];
    } while (word === state.taboo.currentWord);
    return word;
}

// 玩家按下「抽取字卡」→ 進倒數 → 顯示字卡
export function startTabooDrawCountdown() {
    cleanupTabooLocalState();
    state.taboo.currentWord = drawRandomTabooWord();

    let secondsLeft = 5;
    const numEl = document.getElementById('taboo-countdown-num');
    if (numEl) numEl.innerText = secondsLeft;
    switchView('view-taboo-countdown');

    state.taboo.countdownInterval = setInterval(() => {
        secondsLeft--;
        if (numEl) numEl.innerText = secondsLeft > 0 ? secondsLeft : 'GO!';
        if (secondsLeft <= 0) {
            clearInterval(state.taboo.countdownInterval);
            state.taboo.countdownInterval = null;
            setTimeout(showTabooCard, 350);
        }
    }, 1000);
}

// 顯示字卡畫面
export function showTabooCard() {
    const wordEl = document.getElementById('taboo-card-word');
    if (wordEl) {
        wordEl.innerText = state.taboo.currentWord || '???';
        if (state.taboo.flipMode) wordEl.classList.add('flip');
        else wordEl.classList.remove('flip');
    }
    switchView('view-taboo-card');
}

// 房主送出 START_TABOO_GAME / END_TABOO_GAME
export function hostStartTabooGame() {
    if (!state.amIHost) return;
    if (!sendAction('START_TABOO_GAME')) {
        alert('連線中斷,無法發起遊戲');
    }
}

export function hostEndTabooGame() {
    if (!state.amIHost) return;
    if (!sendAction('END_TABOO_GAME')) {
        cleanupTabooLocalState();
        switchView('view-focus');
    }
}
