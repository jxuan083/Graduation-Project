// core/awayReport.js — 跑出 App 沒回來的回報（0 分規則，只有 iOS App）
//
// 聚會中跑出 App、一直到聚會結束都沒回來 → 這場 0 分。網頁版分不出「跑去別的 App」和「關螢幕」，
// 所以只有原生 App 做：前端在聚會中（不在暫離、帶出點餐、主持人開放時）先把後端網址與登入資訊交給原生，
// 原生在背景確認不是在 App 內關螢幕後，回報後端 POST /api/rooms/{id}/left-app。
// 回到 App 時前端照常送「回到 App」，後端就清掉這筆紀錄。
import { state } from './state.js';
import { apiBase } from './api.js';
import { getAuthHeaders } from './auth.js?v=80';

const HEADERS_TTL_MS = 5 * 60 * 1000;   // 登入憑證定期換新（避免在背景送出時已經過期）
let _headers = null;
let _headersAt = 0;
let _key = '';
let _busy = false;

function plugin() {
    const p = window.Capacitor?.Plugins?.LockState;
    return p && typeof p.setAwayReport === 'function' ? p : null;
}

export async function syncAwayReport(armed) {
    const p = plugin();
    if (!p || _busy) return;
    _busy = true;
    try {
        if (armed && (!_headers || Date.now() - _headersAt > HEADERS_TTL_MS)) {
            try {
                _headers = await getAuthHeaders();
                _headersAt = Date.now();
            } catch (_) {
                _headers = null;
            }
        }
        const on = armed && !!_headers && !!state.roomId;
        const url = on ? `${apiBase}/api/rooms/${state.roomId}/left-app` : '';
        const key = on ? `${url}|${_headersAt}` : 'off';
        if (key === _key) return;
        _key = key;
        await p.setAwayReport({ armed: on, url, headers: on ? _headers : {} });
    } catch (_) {
        /* 原生沒有這個方法（舊版 App）就略過 */
    } finally {
        _busy = false;
    }
}
