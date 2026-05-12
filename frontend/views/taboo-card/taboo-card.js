// views/taboo-card/taboo-card.js
import { register } from '../../core/router.js';
import {
    enterTabooPrepare,
    startTabooDrawCountdown,
} from '../../features/taboo/controller.js';

export function init() {
    register('view-taboo-card', { element: document.getElementById('view-taboo-card') });
    document.getElementById('btn-taboo-next').addEventListener('click', startTabooDrawCountdown);
    document.getElementById('btn-taboo-back-to-prepare').addEventListener('click', enterTabooPrepare);
}
