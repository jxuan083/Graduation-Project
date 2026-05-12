// views/taboo-prepare/taboo-prepare.js
import { register } from '../../core/router.js';
import {
    enterTabooPrepare,
    startTabooDrawCountdown,
    hostEndTabooGame,
} from '../../features/taboo/controller.js';

export function init() {
    register('view-taboo-prepare', { element: document.getElementById('view-taboo-prepare') });
    document.getElementById('btn-taboo-draw').addEventListener('click', startTabooDrawCountdown);
    document.getElementById('btn-end-taboo').addEventListener('click', hostEndTabooGame);

    // 給其他模組可以呼叫
    window.__enterTabooPrepare = enterTabooPrepare;
}
