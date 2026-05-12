// views/groups/groups.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';

export function init() {
    register('view-groups', {
        element: document.getElementById('view-groups'),
        onShow: loadGroups,
    });

    const btnBack = document.getElementById('btn-groups-back');
    if (btnBack) btnBack.onclick = () => switchView('view-home');

    const btnCreate = document.getElementById('btn-create-group');
    if (btnCreate) btnCreate.onclick = () => {
        state.currentGroupDetail = null;
        switchView('view-group-setup');
    };
}

async function loadGroups() {
    const listEl = document.getElementById('groups-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="hint">載入中…</p>';

    try {
        const { fetchMyGroups } = await import('../../features/groups/controller.js');
        const groups = await fetchMyGroups();
        if (!groups.length) {
            listEl.innerHTML = '<p class="hint">還沒有群組，建立一個吧！</p>';
            return;
        }
        listEl.innerHTML = '';
        groups.forEach(g => {
            const card = document.createElement('div');
            card.className = 'group-card';
            const petEmoji = g.pet_body_emoji || '🐾';
            const petStatus = g.pet_status || 'NORMAL';
            const statusLabel = { HAPPY: '😊 很開心', NORMAL: '😐 普通', HUNGRY: '😟 肚子餓', CRITICAL: '💀 危急' }[petStatus] || '';
            card.innerHTML = `
                <div class="group-card-main">
                    <span class="group-pet-icon">${petEmoji}</span>
                    <div>
                        <div class="group-name">${escHtml(g.name)}</div>
                        <div class="group-meta">${g.member_count} 人 · 寵物：${statusLabel}</div>
                    </div>
                </div>
                <button class="btn-mini secondary btn-group-detail" data-id="${g.group_id}">管理</button>
            `;
            card.querySelector('.btn-group-detail').onclick = () => {
                state.currentGroupDetail = g;
                switchView('view-group-setup');
            };
            listEl.appendChild(card);
        });
    } catch (err) {
        listEl.innerHTML = `<p class="hint error">載入失敗：${err.message || err}</p>`;
    }
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
