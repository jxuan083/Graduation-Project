// features/groups/controller.js — 群組 API 封裝
import { apiFetch, apiBase } from '../../core/api.js';
import { getAuthHeaders } from '../../core/firebase.js';
import { state } from '../../core/state.js';

export async function fetchMyGroups() {
    const { data } = await apiFetch('/api/groups');
    state.myGroups = data?.groups || [];
    return state.myGroups;
}

export async function fetchGroupDetail(groupId) {
    const { data } = await apiFetch(`/api/groups/${groupId}`);
    // 只有成功抓到 group 才更新；抓不到（API 失敗/沒後端）就保留現有的 currentGroupDetail，
    // 否則會把它清成 null，導致群組頁上所有「if (currentGroupDetail)」的按鈕全部按不動。
    if (data?.group) state.currentGroupDetail = data.group;
    return data?.group || null;
}

export async function createGroup(name) {
    return apiFetch('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
}

export async function updateGroupName(groupId, name) {
    return apiFetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
    });
}

export async function addGroupMember(groupId, identifier) {
    const body = identifier.includes('@') ? { email: identifier } : { uid: identifier };
    return apiFetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function removeGroupMember(groupId, targetUid) {
    return apiFetch(`/api/groups/${groupId}/members/${targetUid}`, { method: 'DELETE' });
}

export async function voteForPet(groupId, targetUid) {
    return apiFetch(`/api/groups/${groupId}/pet/vote`, {
        method: 'POST',
        body: JSON.stringify({ target_uid: targetUid }),
    });
}

export async function updatePet(groupId, fields) {
    return apiFetch(`/api/groups/${groupId}/pet`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
    });
}

export async function fetchPetStatus(groupId) {
    return apiFetch(`/api/groups/${groupId}/pet`);
}

export async function getGroupInviteInfo(code) {
    return apiFetch(`/api/group_invite/${code}`);
}

export async function joinGroupByInviteCode(code) {
    return apiFetch('/api/group_invite/join', {
        method: 'POST',
        body: JSON.stringify({ code }),
    });
}

export async function refreshGroupInviteCode(groupId) {
    return apiFetch(`/api/groups/${groupId}/invite_code/refresh`, { method: 'POST' });
}

// 把生成好的寵物臉 blob 設為群組頭像（multipart，需自行移除 Content-Type 讓瀏覽器帶 boundary）
export async function setGroupPetFace(groupId, blob, targetUid) {
    const formData = new FormData();
    formData.append('file', blob, 'pet_face.jpg');
    if (targetUid) formData.append('target_uid', targetUid);

    const headers = await getAuthHeaders();
    delete headers['Content-Type'];
    const res = await fetch(`${apiBase}/api/groups/${groupId}/pet-face`, {
        method: 'POST',
        headers,
        body: formData,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not json */ }
    return { res, data };
}
