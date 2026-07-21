// views/groups/groups.js — 加入 / 建立群組（front-preview screen-join-group）
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { t } from '../../core/i18n.js';

const selectedFriendUids = new Set();

export function init() {
    register('view-groups', {
        element: document.getElementById('view-groups'),
        onShow: () => { selectedFriendUids.clear(); loadFriendsForInvite(); },
    });

    document.getElementById('btn-groups-back').onclick = () => switchView('view-home');
    document.getElementById('btn-jg-join').onclick = handleJoinByInvite;
    document.getElementById('btn-jg-create').onclick = handleCreateGroup;
}

// ── 好友清單（可勾選邀請）──
async function loadFriendsForInvite() {
    const listEl = document.getElementById('jg-friend-list');
    if (!listEl) return;
    if (!state.currentUser) {
        listEl.innerHTML = `<p class="hint" id="jg-friend-hint">${t('登入後即可邀請好友')}</p>`;
        return;
    }
    listEl.innerHTML = `<p class="hint" id="jg-friend-hint">${t('載入好友中…')}</p>`;
    try {
        const { data } = await apiFetch('/api/friends');
        const friends = (data && data.friends) || [];
        if (!friends.length) {
            listEl.innerHTML = `<p class="hint" id="jg-friend-hint">${t('還沒有好友，先去加好友吧！')}</p>`;
            return;
        }
        listEl.innerHTML = friends.map(f => {
            const rawName = f.nickname_snapshot || f.nickname || f.uid;
            const photo = f.avatar_snapshot || f.avatar_url || f.photoURL;
            const name = escHtml(rawName);
            const avatar = photo
                ? `<div class="friend-avatar" style="width:42px;height:42px;overflow:hidden;flex-shrink:0;"><img src="${escHtml(photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
                : `<div class="friend-avatar" style="width:42px;height:42px;background:var(--brown-10);font-size:18px;flex-shrink:0;">${escHtml((rawName || '?')[0].toUpperCase())}</div>`;
            return `<div class="jg-friend-row">
                ${avatar}
                <div style="flex:1;"><p class="friend-name">${name}</p></div>
                <button class="jg-invite-btn" data-uid="${escHtml(f.uid)}" data-invited="0">邀請</button>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.jg-invite-btn').forEach(btn => {
            btn.onclick = () => {
                const uid = btn.dataset.uid;
                const invited = btn.dataset.invited === '1';
                if (invited) { selectedFriendUids.delete(uid); btn.dataset.invited = '0'; btn.textContent = '邀請'; btn.classList.remove('invited'); }
                else { selectedFriendUids.add(uid); btn.dataset.invited = '1'; btn.textContent = '已選'; btn.classList.add('invited'); }
            };
        });
    } catch (err) {
        listEl.innerHTML = `<p class="hint error">${t('載入好友失敗：')}${err.message || err}</p>`;
    }
}

// ── 用邀請碼加入 ──
async function handleJoinByInvite() {
    const input = document.getElementById('jg-invite-code');
    const code = input?.value?.trim();
    if (!code) { alert(t('請輸入邀請碼')); return; }
    if (!state.currentUser) { alert(t('請先登入 Google 帳號，才能加入群組')); return; }

    const btn = document.getElementById('btn-jg-join');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = t('加入中…');
    try {
        const { getGroupInviteInfo, joinGroupByInviteCode, fetchMyGroups } = await import('../../features/groups/controller.js?v=39');
        const { res, data: info } = await getGroupInviteInfo(code);
        if (!res.ok || !info?.name) {
            alert(t('邀請碼無效或已過期：') + (info?.detail || `HTTP ${res.status}`));
            return;
        }
        if (info.already_member) {
            alert(t('你已經是「{name}」的成員了！', { name: info.name }));
            return;
        }
        const ok = confirm(t('加入群組「{name}」（{count} 位成員）？', { name: info.name, count: info.member_count }));
        if (!ok) return;
        const { data: joinData } = await joinGroupByInviteCode(code);
        if (joinData?.status === 'success') {
            if (input) input.value = '';
            await fetchMyGroups();
            alert(t('成功加入群組！'));
            switchView('view-home');
        } else {
            alert(t('加入失敗：') + (joinData?.detail || JSON.stringify(joinData)));
        }
    } catch (err) {
        alert(t('加入失敗：') + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ── 建立群組（含直接邀請已選好友）──
async function handleCreateGroup() {
    const nameInput = document.getElementById('jg-new-name');
    const name = nameInput?.value?.trim();
    if (!name) { alert(t('請輸入群組名稱')); return; }
    if (!state.currentUser) { alert(t('請先登入 Google 帳號，才能建立群組')); return; }

    const btn = document.getElementById('btn-jg-create');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = t('建立中…');
    try {
        const { createGroup, addGroupMember, fetchMyGroups } = await import('../../features/groups/controller.js?v=39');
        const { data } = await createGroup(name);
        const groupId = data?.group?.group_id || data?.group_id;
        if (!groupId) {
            alert(t('建立失敗：') + (data?.detail || JSON.stringify(data)));
            return;
        }

        // 邀請已勾選的好友（逐一加入；個別失敗不中斷）
        const failed = [];
        for (const uid of selectedFriendUids) {
            try {
                const { data: addData } = await addGroupMember(groupId, uid);
                if (addData?.status !== 'success') failed.push(uid);
            } catch (_) { failed.push(uid); }
        }

        await fetchMyGroups();
        if (failed.length) alert(t('群組已建立，但有 {count} 位好友邀請失敗', { count: failed.length }));

        if (nameInput) nameInput.value = '';
        selectedFriendUids.clear();
        state.currentGroupDetail = { group_id: groupId, name };
        switchView('view-group');
    } catch (err) {
        alert(t('建立失敗：') + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
