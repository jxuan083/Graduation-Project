// views/scanner/scanner.js
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { showJoinView } from '../join/join.js';

export function init() {
    register('view-scanner', { element: document.getElementById('view-scanner') });
    document.getElementById('btn-scanner-cancel').onclick = () => {
        stopQrScanner();
        switchView('view-home');
    };
}

export function startQrScanner() {
    switchView('view-scanner');
    const hint = document.getElementById('scanner-hint');
    if (typeof Html5Qrcode === 'undefined') {
        if (hint) hint.innerText = '掃描函式庫載入失敗,請重新整理頁面';
        return;
    }
    if (hint) hint.innerText = '啟動相機中...';

    state.qrScanner = new Html5Qrcode("scanner-container");
    state.qrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
            console.log('[QR] decoded:', decodedText);
            let rid = null;
            try {
                const u = new URL(decodedText);
                rid = new URLSearchParams(u.search).get('room');
            } catch (_) {
                if (/^[a-z0-9]{4,16}$/i.test(decodedText.trim())) {
                    rid = decodedText.trim();
                }
            }
            if (!rid) {
                if (hint) hint.innerText = '不認得這個 QR Code,再試一次...';
                return;
            }
            stopQrScanner();
            state.pendingRoomId = rid;
            showJoinView();
        },
        () => { /* per-frame fail, ignore */ }
    ).then(() => {
        if (hint) hint.innerText = '把 QR Code 對準框內';
    }).catch((err) => {
        console.error('QR scanner failed:', err);
        if (hint) hint.innerText = '無法啟動相機:' + (err.message || err);
    });
}

export function stopQrScanner() {
    if (state.qrScanner) {
        try { state.qrScanner.stop().catch(() => {}); } catch (e) {}
        try { state.qrScanner.clear(); } catch (e) {}
        state.qrScanner = null;
    }
}
