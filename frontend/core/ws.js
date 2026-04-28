// core/ws.js — WebSocket 連線管理 + 訊息分派
// 取代原本散落在 app.js 的 200 行 onmessage handler
//
// 用法:
//   import { connectRoom, registerHandler, sendAction } from '../core/ws.js';
//   registerHandler('TABOO_STARTED', (msg) => { ... });
//   connectRoom('abc123', 'uid', 'nick');
//   sendAction('CHANGE_MODE', { mode: 'CLASS' });

import { state } from './state.js';
import { events } from './events.js';
import { WS_PROTOCOL, BACKEND_HOST } from './config.js';

const handlers = new Map();   // type → Set<fn>

export function registerHandler(type, handler) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(handler);
    return () => handlers.get(type)?.delete(handler);
}

// 🔒 [C1 修正 v15.2] 已登入使用者連線時必須帶 Firebase ID token,
//    後端會驗證 token 並比對 path uid。訪客不帶 token,後端會 detect。
export async function connectRoom(roomId, userId, nickname, onOpen) {
    state.roomId = roomId;
    const nickParam = encodeURIComponent(nickname || '訪客');

    // 已登入使用者:取 Firebase ID token 帶在 query param
    let tokenParam = '';
    if (state.currentUser) {
        try {
            const idToken = await state.currentUser.getIdToken(/* forceRefresh */ false);
            tokenParam = `&token=${encodeURIComponent(idToken)}`;
        } catch (err) {
            console.error('[WS] failed to get ID token,連線會被後端拒絕:', err);
            // 不 return — 讓連線開出去,onclose 會收到 4401 然後觸發錯誤處理
        }
    }

    const url = `${WS_PROTOCOL}${BACKEND_HOST}/ws/${roomId}/${userId}?nickname=${nickParam}${tokenParam}`;
    const ws = new WebSocket(url);
    state.ws = ws;

    ws.onopen = () => {
        events.emit('ws:open');
        onOpen?.();
    };

    ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); }
        catch (e) { console.error('[WS] parse error:', e); return; }

        console.log('[WS RECV]', msg);
        const set = handlers.get(msg.type);
        if (set) {
            for (const fn of set) {
                try { fn(msg); }
                catch (err) { console.error(`[WS] handler "${msg.type}" threw:`, err); }
            }
        }
        // 同時也用 event bus 廣播,讓多個 view 可以監聽同一個訊息
        events.emit(`ws:${msg.type}`, msg);
    };

    ws.onerror = (err) => console.error('[WS ERROR]', err);
    ws.onclose = (e) => {
        console.warn('[WS CLOSED]', e.code, e.reason);
        events.emit('ws:close', e);
        // 4401 = 缺/壞 token, 4403 = uid 不匹配 — 讓使用者知道
        if (e.code === 4401 || e.code === 4403) {
            try {
                import('../utils/toast.js').then(({ showToast }) =>
                    showToast(`連線被拒絕:${e.reason || '身份驗證失敗'}`, 'warn')
                );
            } catch (_) {}
        }
    };
}

export function sendAction(action, payload = {}) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        console.warn(`[WS] cannot send "${action}" — connection not open`);
        return false;
    }
    state.ws.send(JSON.stringify({ action, ...payload }));
    return true;
}

export function closeWs() {
    if (state.ws) {
        try { state.ws.close(); } catch (_) {}
        state.ws = null;
    }
}
