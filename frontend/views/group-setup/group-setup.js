// views/group-setup/group-setup.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { PET_BODY_OPTIONS } from '../../core/config.js';
import { t } from '../../core/i18n.js';

let currentGroupId = null;
let selectedPetBody = null;

export function init() {
    register('view-group-setup', {
        element: document.getElementById('view-group-setup'),
        onShow: onShow,
    });

    const btnBack = document.getElementById('btn-group-setup-back');
    if (btnBack) btnBack.onclick = () => switchView(state.currentGroupDetail ? 'view-group' : 'view-groups');

    const btnSaveName = document.getElementById('btn-save-group-name');
    if (btnSaveName) btnSaveName.onclick = handleSaveName;

    const btnAddMember = document.getElementById('btn-add-member');
    if (btnAddMember) btnAddMember.onclick = handleAddMember;

    const btnSavePet = document.getElementById('btn-save-pet-body');
    if (btnSavePet) btnSavePet.onclick = handleSavePetBody;

    const btnCopyInvite = document.getElementById('btn-copy-invite');
    if (btnCopyInvite) btnCopyInvite.onclick = handleCopyInvite;

    const btnRefreshInvite = document.getElementById('btn-refresh-invite');
    if (btnRefreshInvite) btnRefreshInvite.onclick = handleRefreshInvite;

    const btnLeave = document.getElementById('btn-leave-group');
    if (btnLeave) btnLeave.onclick = handleLeaveGroup;

    buildPetBodyGrid();
}

function buildPetBodyGrid() {
    const grid = document.getElementById('pet-body-grid');
    if (!grid) return;
    grid.innerHTML = '';
    PET_BODY_OPTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'pet-body-btn';
        btn.textContent = emoji;
        btn.dataset.emoji = emoji;
        btn.onclick = () => {
            document.querySelectorAll('.pet-body-btn').forEach(b => b.classList.remove('active-body'));
            btn.classList.add('active-body');
            selectedPetBody = emoji;
        };
        grid.appendChild(btn);
    });
}

async function onShow() {
    const g = state.currentGroupDetail;
    const titleEl = document.getElementById('group-setup-title');
    const nameInput = document.getElementById('group-name-input');

    if (!g) {
        currentGroupId = null;
        if (titleEl) titleEl.textContent = '建立新群組';
        if (nameInput) nameInput.value = '';
        hideExistingGroupSections();
        return;
    }

    currentGroupId = g.group_id;
    if (titleEl) titleEl.textContent = '群組設定';
    if (nameInput) nameInput.value = g.name || '';

    showExistingGroupSections();
    await refreshGroupDetail();
}

function hideExistingGroupSections() {
    ['group-invite-section', 'group-members-section', 'pet-vote-section', 'pet-body-section', 'pet-preview-section']
        .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

function showExistingGroupSections() {
    ['group-invite-section', 'group-members-section', 'pet-vote-section', 'pet-body-section']
        .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
}

async function refreshGroupDetail() {
    if (!currentGroupId) return;
    try {
        const { fetchGroupDetail } = await import('../../features/groups/controller.js');
        const g = await fetchGroupDetail(currentGroupId);
        if (!g) return;
        renderInviteCode(g);
        renderMembers(g);
        renderPetVote(g);
        renderPetPreview(g);
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error('refresh group detail failed:', err);
    }
}

function renderInviteCode(g) {
    const codeEl = document.getElementById('invite-code-display');
    const refreshBtn = document.getElementById('btn-refresh-invite');
    const code = g.invite_code || '';
    if (codeEl) codeEl.textContent = code || '—';
    const isCreator = g.creator_uid === state.currentUser?.uid;
    if (refreshBtn) refreshBtn.style.display = isCreator ? '' : 'none';
}

async function handleCopyInvite() {
    const g = state.currentGroupDetail;
    const code = g?.invite_code;
    if (!code) { alert(t('邀請碼尚未生成，請稍後再試')); return; }
    const link = `${window.location.protocol}//${window.location.host}/?group_invite=${code}`;
    try {
        await navigator.clipboard.writeText(link);
        const btn = document.getElementById('btn-copy-invite');
        if (btn) { btn.textContent = '✓ 已複製'; setTimeout(() => { btn.textContent = '複製連結'; }, 2000); }
    } catch {
        prompt('複製此連結：', link);
    }
}

async function handleRefreshInvite() {
    if (!currentGroupId) return;
    if (!confirm(t('確定重新產生邀請碼？舊的邀請碼將立即失效。'))) return;
    try {
        const { refreshGroupInviteCode } = await import('../../features/groups/controller.js');
        const { data } = await refreshGroupInviteCode(currentGroupId);
        if (data?.invite_code) {
            if (state.currentGroupDetail) state.currentGroupDetail.invite_code = data.invite_code;
            const codeEl = document.getElementById('invite-code-display');
            if (codeEl) codeEl.textContent = data.invite_code;
        } else {
            alert(t('重新產生失敗：') + (data?.detail || JSON.stringify(data)));
        }
    } catch (err) { alert(t('重新產生失敗：') + (err.message || err)); }
}

function renderMembers(g) {
    const ul = document.getElementById('group-member-list');
    const countEl = document.getElementById('group-member-count');
    const leaveBtn = document.getElementById('btn-leave-group');
    const members = g.members || [];
    const myUid = state.currentUser?.uid;
    const isCreator = g.creator_uid === myUid;
    // 非建立者才顯示退出按鈕
    if (leaveBtn) leaveBtn.style.display = (!isCreator && myUid) ? '' : 'none';
    if (countEl) countEl.textContent = members.length;
    if (!ul) return;
    ul.innerHTML = '';

    members.forEach(m => {
        const li = document.createElement('li');
        li.className = 'member-li';
        const isMe = m.uid === myUid;
        const canRemove = isCreator || isMe;
        li.innerHTML = `
            <span class="member-name">${escHtml(m.nickname || m.uid)}${isMe ? ' (我)' : ''}${m.uid === g.creator_uid ? ' <i data-lucide="crown" class="ico-crown"></i>' : ''}</span>
            <div style="display:flex;gap:6px;align-items:center;">
                <button class="btn-mini secondary btn-pet-gen" data-uid="${m.uid}" data-nickname="${escHtml(m.nickname || m.uid)}" title="生成寵物臉"><i data-lucide="paw-print"></i></button>
                ${canRemove ? `<button class="btn-mini secondary btn-rm-member" data-uid="${m.uid}">移除</button>` : ''}
            </div>
        `;
        ul.appendChild(li);
    });

    ul.querySelectorAll('.btn-pet-gen').forEach(btn => {
        btn.onclick = () => {
            state.petSwapTarget = { uid: btn.dataset.uid, nickname: btn.dataset.nickname };
            switchView('view-pet-swap');
        };
    });

    ul.querySelectorAll('.btn-rm-member').forEach(btn => {
        btn.onclick = async () => {
            if (!confirm(t('確定移除？'))) return;
            try {
                const { removeGroupMember } = await import('../../features/groups/controller.js');
                await removeGroupMember(currentGroupId, btn.dataset.uid);
                await refreshGroupDetail();
            } catch (err) { alert(t('移除失敗：') + (err.message || err)); }
        };
    });
}

function renderPetVote(g) {
    const ul = document.getElementById('pet-vote-list');
    const statusEl = document.getElementById('pet-vote-status');
    if (!ul) return;
    ul.innerHTML = '';
    const members = g.members || [];
    const myUid = state.currentUser?.uid;
    const votes = g.pet_votes || {};
    const myVote = votes[myUid];
    const petTargetUid = g.pet_target_uid;

    if (petTargetUid) {
        const target = members.find(m => m.uid === petTargetUid);
        if (statusEl) statusEl.textContent = t('已選定：{name} 為群組寵物', { name: target?.nickname || petTargetUid });
    } else {
        const voteCount = Object.keys(votes).length;
        if (statusEl) statusEl.textContent = t('已投票 {count}/{total} 人', { count: voteCount, total: members.length });
    }

    members.forEach(m => {
        const li = document.createElement('li');
        li.className = 'member-li';
        const voteCount = Object.values(votes).filter(v => v === m.uid).length;
        const isMyVote = myVote === m.uid;
        const isPet = m.uid === petTargetUid;
        li.innerHTML = `
            <span class="member-name">${escHtml(m.nickname || m.uid)}${isPet ? ' <i data-lucide="paw-print"></i>' : ''}</span>
            <span class="vote-count">${voteCount} 票</span>
            <button class="btn-mini ${isMyVote ? 'primary' : 'secondary'} btn-vote" data-uid="${m.uid}">
                ${isMyVote ? '已投票' : '投票'}
            </button>
        `;
        ul.appendChild(li);
    });

    ul.querySelectorAll('.btn-vote').forEach(btn => {
        btn.onclick = async () => {
            try {
                const { voteForPet } = await import('../../features/groups/controller.js');
                const { data } = await voteForPet(currentGroupId, btn.dataset.uid);
                if (data?.status === 'success') await refreshGroupDetail();
                else alert(t('投票失敗') + (data?.detail ? ': ' + data.detail : ''));
            } catch (err) { alert(t('投票失敗：') + (err.message || err)); }
        };
    });
}

function renderPetPreview(g) {
    const section = document.getElementById('pet-preview-section');
    const previewEl = document.getElementById('pet-preview');
    const statsEl = document.getElementById('pet-hp-energy');
    if (!g.pet_target_uid) {
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = '';
    const body = g.pet_body_emoji || '🐾';
    const petName = g.pet_name || '寵物';
    const headHtml = g.pet_face_url
        ? `<img class="pet-head-img" src="${escHtml(g.pet_face_url)}" alt="寵物臉" />`
        : `<div class="pet-head-placeholder"><i data-lucide="user"></i></div>`;
    if (previewEl) {
        previewEl.innerHTML = `
            <div class="pet-display">
                ${headHtml}
                <div class="pet-body-emoji">${body}</div>
                <div class="pet-name">${escHtml(petName)}</div>
            </div>
        `;
    }
    if (statsEl) {
        const hp = g.pet_hp ?? 5;
        const energy = g.pet_energy ?? 50;
        const maxEnergy = g.pet_max_energy ?? 100;
        const statusZh = { HAPPY: '😊 很開心', NORMAL: '😐 普通', HUNGRY: '😟 肚子餓', CRITICAL: '💀 危急' }[g.pet_status] || '';
        const status = statusZh ? t(statusZh) : '';
        statsEl.textContent = t('HP: {hp} | 能量: {energy}/{maxEnergy} | {status}', { hp: '❤️'.repeat(Math.max(0, hp)), energy, maxEnergy, status });
    }
    if (g.pet_body_emoji) {
        document.querySelectorAll('.pet-body-btn').forEach(b => {
            b.classList.toggle('active-body', b.dataset.emoji === g.pet_body_emoji);
        });
        selectedPetBody = g.pet_body_emoji;
    }
}

async function handleLeaveGroup() {
    if (!currentGroupId) return;
    if (!confirm(t('確定退出這個群組？'))) return;
    try {
        const { removeGroupMember } = await import('../../features/groups/controller.js');
        const myUid = state.currentUser?.uid;
        await removeGroupMember(currentGroupId, myUid);
        alert(t('已退出群組'));
        const { switchView } = await import('../../core/router.js');
        switchView('view-groups');
    } catch (err) { alert(t('退出失敗：') + (err.message || err)); }
}

async function handleSaveName() {
    const nameInput = document.getElementById('group-name-input');
    const name = nameInput?.value?.trim();
    if (!name) { alert(t('請輸入群組名稱')); return; }

    try {
        const { createGroup, updateGroupName } = await import('../../features/groups/controller.js');
        if (!currentGroupId) {
            const { data } = await createGroup(name);
            const groupId = data?.group?.group_id || data?.group_id;
            if (groupId) {
                currentGroupId = groupId;
                state.currentGroupDetail = { group_id: currentGroupId, name };
                const titleEl = document.getElementById('group-setup-title');
                if (titleEl) titleEl.textContent = '群組設定';
                showExistingGroupSections();
                await refreshGroupDetail();
                alert(t('群組已建立！'));
            } else {
                alert(t('建立失敗：') + (data?.detail || JSON.stringify(data)));
            }
        } else {
            await updateGroupName(currentGroupId, name);
            alert(t('名稱已更新'));
        }
    } catch (err) { alert(t('操作失敗：') + (err.message || err)); }
}

async function handleAddMember() {
    const input = document.getElementById('add-member-input');
    const identifier = input?.value?.trim();
    if (!identifier) { alert(t('請輸入 Email 或 UID')); return; }
    if (!currentGroupId) { alert(t('請先儲存群組名稱')); return; }
    try {
        const { addGroupMember } = await import('../../features/groups/controller.js');
        const { data } = await addGroupMember(currentGroupId, identifier);
        if (data?.status === 'success') {
            if (input) input.value = '';
            await refreshGroupDetail();
        } else {
            alert(t('新增失敗：') + (data?.detail || JSON.stringify(data)));
        }
    } catch (err) { alert(t('新增失敗：') + (err.message || err)); }
}

async function handleSavePetBody() {
    if (!selectedPetBody) { alert(t('請選擇一個動物身體')); return; }
    if (!currentGroupId) return;
    try {
        const { updatePet } = await import('../../features/groups/controller.js');
        const { data } = await updatePet(currentGroupId, { pet_body_emoji: selectedPetBody });
        if (data?.status === 'success') {
            await refreshGroupDetail();
            alert(t('身體造型已更新！'));
        } else {
            alert(t('更新失敗：') + (data?.detail || JSON.stringify(data)));
        }
    } catch (err) { alert(t('更新失敗：') + (err.message || err)); }
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
