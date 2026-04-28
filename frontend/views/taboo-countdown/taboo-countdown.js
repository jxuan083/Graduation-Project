// views/taboo-countdown/taboo-countdown.js
import { register } from '../../core/router.js';

export function init() {
    register('view-taboo-countdown', { element: document.getElementById('view-taboo-countdown') });
    // 此頁所有更新由 features/taboo/controller.js 處理
}
