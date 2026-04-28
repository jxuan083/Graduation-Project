// views/about/about.js
import { register } from '../../core/router.js';
import { goHomeFromMenu } from '../../core/session.js';

export function init() {
    register('view-about', { element: document.getElementById('view-about') });
    document.getElementById('btn-about-back').onclick = goHomeFromMenu;
}
