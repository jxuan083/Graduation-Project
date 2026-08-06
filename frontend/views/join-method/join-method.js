// views/join-method/join-method.js — 加入聚會入口頁
import { back, register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { startQrScanner } from '../scanner/scanner.js';
import { showJoinView } from '../join/join.js';

export function init() {
    register('view-join-method', {
        element: document.getElementById('view-join-method'),
        onShow,
    });

    document.getElementById('btn-join-method-back').onclick = back;
    document.getElementById('btn-join-method-scan').onclick = startQrScanner;
    document.getElementById('btn-join-method-code').onclick = joinByTypedCode;
    document.getElementById('join-method-code').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') joinByTypedCode();
    });
}

function onShow() {
    const input = document.getElementById('join-method-code');
    if (input) input.value = '';
    if (window.lucide) window.lucide.createIcons();
    // 不自動 focus：進頁面就彈鍵盤會遮住其他加入方式（掃碼等），
    // 使用者要自己選擇要用哪一種。驗證失敗時才主動 focus。
}

function joinByTypedCode() {
    const input = document.getElementById('join-method-code');
    const code = (input?.value || '').trim();
    const roomId = parseRoomCode(code);
    if (!roomId) {
        alert(t('請輸入有效的聚會碼或邀請連結'));
        input?.focus();
        return;
    }
    state.pendingRoomId = roomId;
    showJoinView();
}

function parseRoomCode(raw) {
    if (!raw) return '';
    try {
        const url = new URL(raw);
        const room = new URLSearchParams(url.search).get('room');
        if (room) return room.trim();
    } catch (_) {
        // Not a URL; treat it as a direct room code.
    }
    const cleaned = raw.replace(/\s+/g, '');
    return /^[a-z0-9-]{4,36}$/i.test(cleaned) ? cleaned : '';
}
