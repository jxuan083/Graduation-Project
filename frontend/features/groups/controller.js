// features/groups/controller.js — 群組 API 封裝
import { apiFetch } from '../../core/api.js';
import { state } from '../../core/state.js';

export async function fetchMyGroups() {
    const { data } = await apiFetch('/api/groups');
    state.myGroups = data?.groups || [];
    return state.myGroups;
}

export async function fetchGroupDetail(groupId) {
    const { data } = await apiFetch(`/api/groups/${groupId}`);
    state.currentGroupDetail = data?.group || null;
    return state.currentGroupDetail;
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
