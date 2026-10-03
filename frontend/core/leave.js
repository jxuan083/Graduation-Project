// core/leave.js — 個人離開聚會／暫離延長的 API 呼叫，以及「誰還在場」的判斷
//
// 離開與延長走 HTTP 而不是 WebSocket：App 在背景或剛被喚醒時 WS 多半已斷，
// 而這兩個動作正好常在那種時候發生（從「暫離時間到」通知按下去）。
import { state } from './state.js';
import { apiFetch } from './api.js';
import { t } from './i18n.js';

// 每場最多加回幾次（顯示用鏡像；真正把關在 backend/attendance.py，由測試鎖住兩邊一致）
export const REJOIN_LIMIT = 2;

export const isPresentMember = (info) => !!info && info.state !== 'LEFT';

// 還在場的成員（[uid, info]），不含已離開聚會的人
export function presentMemberEntries(members = state.roomMembers) {
    return Object.entries(members || {}).filter(([, info]) => isPresentMember(info));
}

// 這場聚會我還能加回幾次
export function myRejoinsLeft() {
    const used = Number(state.roomAllParticipants?.[state.userId]?.rejoin_count || 0);
    return Math.max(0, REJOIN_LIMIT - used);
}

async function postRoom(path, body, fallbackError) {
    if (!state.roomId) throw new Error(t(fallbackError));
    const { res, data } = await apiFetch(`/api/rooms/${state.roomId}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    if (!res.ok || !data || data.status !== 'success') {
        throw new Error((data && data.detail) || t(fallbackError));
    }
    return data;
}

// 離開進行中的聚會（其他人繼續）。回傳後端算到離開為止的個人結算：
// { duration_minutes, deviations, score, rejoins_left, session_ended? }
export function requestLeaveSession({ fromTimeout = false } = {}) {
    return postRoom('/leave', { from_timeout: fromTimeout }, '離開聚會失敗');
}

// 暫離延長一次。回傳 { window_sec, remaining_sec }
export function requestExtendIntent() {
    return postRoom('/intent/extend', {}, '延長暫離失敗');
}
