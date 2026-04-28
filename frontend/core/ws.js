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

// 🔒 [Bug 5 修正 v15.3] token 改用 first-message handshake (不再放 URL query)
//    流程:open → 立刻送 {action:"AUTH", token, nickname} → 等 AUTH_OK → 才呼叫 onOpen
export async function connectRoom(roomId, userId, nickname, onOpen) {
    state.roomId = roomId;

    // 預先取 ID token(若已登入)
    let idToken = null;
    if (state.currentUser) {
        try {
            idToken = await state.currentUser.getIdToken(/* forceRefresh */ false);
        } catch (err) {
            console.error('[WS] failed to get ID token,連線會被後端拒絕:', err);
        }
    }

    // URL 不再帶 token,僅保留 nickname 作為 server-side fallback
    const nickParam = encodeURIComponent(nickname || '訪客');
    const url = `${WS_PROTOCOL}${BACKEND_HOST}/ws/${roomId}/${userId}?nickname=${nickParam}`;
    const ws = new WebSocket(url);
    state.ws = ws;

    let authed = false;

    ws.onopen = () => {
        // 連線打開後立刻送 AUTH frame
        try {
            ws.send(JSON.stringify({
                action: 'AUTH',
                token: idToken,            // 訪客為 null,後端會根據 user_id 格式辨識
                nickname: nickname || '訪客',
            }));
        } catch (err) {
            console.error('[WS] failed to send AUTH:', err);
        }
    };

    ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); }
        catch (e) { console.error('[WS] parse error:', e); return; }

        // 第一個 AUTH_OK 才視為連線成功,呼叫上層 onOpen
        if (!authed && msg.type === 'AUTH_OK') {
            authed = true;
            events.emit('ws:open');
            onOpen?.();
            return;
        }

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
