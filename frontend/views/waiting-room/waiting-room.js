// views/waiting-room/waiting-room.js
import { register, switchView } from '../../core/router.js';
import { cleanupSession } from '../../core/session.js';

export function init() {
    register('view-waiting-room', { element: document.getElementById('view-waiting-room') });
    document.getElementById('btn-leave-waiting').onclick = () => {
        if (confirm('確定要離開聚會嗎?')) {
            cleanupSession();
            switchView('view-home');
        }
    };
}
