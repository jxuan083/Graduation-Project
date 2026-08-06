// views/more/more.js — 「更多」的預設空白版面，功能待定
import { register, back } from '../../core/router.js';

export function init() {
    register('view-more', {
        element: document.getElementById('view-more'),
    });

    const backBtn = document.getElementById('btn-more-back');
    if (backBtn) backBtn.onclick = () => back();
}
