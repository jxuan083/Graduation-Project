// views/groups/groups.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { t } from '../../core/i18n.js';

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

    const btnJoin = document.getElementById('btn-join-by-invite');
    if (btnJoin) btnJoin.onclick = handleJoinByInvite;
}

async function handleJoinByInvite() {
    const input = document.getElementById('group-invite-input');
    const code = input?.value?.trim();
    if (!code) { alert(t('請輸入邀請碼')); return; }
    if (!state.currentUser) { alert(t('請先登入 Google 帳號，才能加入群組')); return; }

    const btn = document.getElementById('btn-join-by-invite');
    btn.disabled = true;
    btn.textContent = '加入中…';
    try {
        const { getGroupInviteInfo, joinGroupByInviteCode } = await import('../../features/groups/controller.js');
        const { res, data: info } = await getGroupInviteInfo(code);
        if (!res.ok || !info?.name) {
            alert(t('邀請碼無效或已過期：') + (info?.detail || `HTTP ${res.status}`));
            return;
        }
        if (info.already_member) {
            alert(t('你已經是「{name}」的成員了！', { name: info.name }));
            if (input) input.value = '';
            return;
        }
        const ok = confirm(t('加入群組「{name}」（{count} 位成員）？', { name: info.name, count: info.member_count }));
        if (!ok) return;
        const { data: joinData } = await joinGroupByInviteCode(code);
        if (joinData?.status === 'success') {
            if (input) input.value = '';
            alert(t('成功加入群組！'));
            await loadGroups();
        } else {
            alert(t('加入失敗：') + (joinData?.detail || JSON.stringify(joinData)));
        }
    } catch (err) {
        alert(t('加入失敗：') + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.textContent = '加入';
    }
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
            const avatarHtml = g.pet_face_url
                ? `<img class="group-avatar-img" src="${escHtml(g.pet_face_url)}" alt="" />`
                : `<span class="group-pet-icon">${petEmoji}</span>`;
            card.innerHTML = `
                <div class="group-card-main">
                    ${avatarHtml}
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
