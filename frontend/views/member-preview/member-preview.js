// views/member-preview/member-preview.js — 成員預覽 modal (浮層)
import { register } from '../../core/router.js';
import { closeMemberPreview } from '../../features/members/preview.js';

export function init() {
    // member-preview 是 modal 不是 view,但仍註冊讓 router 能找到 (不參與 active 切換)
    register('view-member-preview', { element: document.getElementById('view-member-preview') });

    document.getElementById('btn-member-preview-close').onclick = closeMemberPreview;

    // 點 modal 外面遮罩關閉
    const modal = document.getElementById('view-member-preview');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeMemberPreview();
        });
    }
    // Esc 關閉
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeMemberPreview();
        }
    });
}
