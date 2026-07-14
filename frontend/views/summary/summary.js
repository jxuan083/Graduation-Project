// views/summary/summary.js
import { register } from '../../core/router.js';

// 聚會總結頁：隱藏右上角帳號 chip（聚會結束畫面不需要），
// 帳號 chip 藏掉後，語言切換(中/EN)自然變成右上角最右邊的元素。
let _savedChipDisplay = null;

function onShow() {
    const chip = document.getElementById('auth-logged-in');
    if (chip) { _savedChipDisplay = chip.style.display; chip.style.display = 'none'; }
}

function onHide() {
    const chip = document.getElementById('auth-logged-in');
    if (chip && _savedChipDisplay !== null) { chip.style.display = _savedChipDisplay; _savedChipDisplay = null; }
}

export function init() {
    register('view-summary', {
        element: document.getElementById('view-summary'),
        onShow,
        onHide,
    });
    // 「回到首頁」按鈕用 inline onclick="location.href='/'" — 不需在這裡綁
}
