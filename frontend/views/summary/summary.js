// views/summary/summary.js
import { register } from '../../core/router.js';

export function init() {
    register('view-summary', { element: document.getElementById('view-summary') });
    // 「回到首頁」按鈕用 inline onclick="location.href='/'" — 不需在這裡綁
}
