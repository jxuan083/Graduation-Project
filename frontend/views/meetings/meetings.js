// views/meetings/meetings.js — 聚會紀錄列表
import { back, register } from '../../core/router.js';
import { openFavoritesList } from '../../features/meetings/controller.js';

export function init() {
    register('view-meetings', { element: document.getElementById('view-meetings') });
    document.getElementById('btn-meetings-back').onclick = back;
    document.getElementById('btn-meetings-favorites').onclick = openFavoritesList;
}
