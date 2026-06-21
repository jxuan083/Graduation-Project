// views/meetings/meetings.js — 聚會紀錄列表
import { register } from '../../core/router.js';
import { goHomeFromMenu } from '../../core/session.js';
import { openFavoritesList } from '../../features/meetings/controller.js';

export function init() {
    register('view-meetings', { element: document.getElementById('view-meetings') });
    document.getElementById('btn-meetings-back').onclick = goHomeFromMenu;
    document.getElementById('btn-meetings-favorites').onclick = openFavoritesList;
}
