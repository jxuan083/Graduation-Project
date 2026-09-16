// views/more/more.js — 「更多」頁：連線診斷。
// 需求（NOTES 2026-08-06）：顯示 IS_NATIVE_APP、解析出的 devHost / BACKEND_HOST /
// emulator hosts，並提供「測試連線」按鈕，把 fetch 的錯誤訊息直接印在畫面上，
// 不需要接 Mac 就能自我診斷。
import { register, back } from '../../core/router.js';
import { updateToggleUI } from '../../core/i18n.js';
import {
    IS_NATIVE_APP,
    BACKEND_HOST,
    HTTP_PROTOCOL,
    FIREBASE_EMULATORS,
    NATIVE_DEV_HOST_STORAGE_KEY,
} from '../../core/config.js';

const BACKEND_BASE = `${HTTP_PROTOCOL}${BACKEND_HOST}`;
const TEST_TIMEOUT_MS = 6000;

function resolvedDevHost() {
    try {
        const stored = localStorage.getItem(NATIVE_DEV_HOST_STORAGE_KEY);
        if (stored) return stored;
    } catch (_) {}
    return (window.PHUBBING_NATIVE_CONFIG && window.PHUBBING_NATIVE_CONFIG.devHost) || '(空)';
}

function capacitorPlatform() {
    try { return window.Capacitor?.getPlatform?.() || '(none)'; } catch (_) { return '(none)'; }
}

function renderEnv() {
    const dl = document.getElementById('diag-env');
    if (!dl) return;
    const rows = [
        ['IS_NATIVE_APP', String(IS_NATIVE_APP)],
        ['platform', capacitorPlatform()],
        ['location', window.location.href],
        ['devHost', resolvedDevHost()],
        ['BACKEND_HOST', BACKEND_BASE],
        ['emulators.enabled', String(FIREBASE_EMULATORS.enabled)],
        ['auth emulator', FIREBASE_EMULATORS.authHost],
        ['storage emulator', `http://${FIREBASE_EMULATORS.storageHost}:${FIREBASE_EMULATORS.storagePort}`],
    ];
    dl.innerHTML = '';
    for (const [label, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.append(dt, dd);
    }
}

// 帶 timeout 的 fetch：連不到 Mac 時常是靜默 hang，加 timeout 才能把它變成
// 看得到的「逾時」訊息，而不是一直轉。
async function probe(label, url, parseJson) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    const started = performance.now();
    try {
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const ms = Math.round(performance.now() - started);
        let detail = '';
        if (parseJson) {
            try { detail = ` ${JSON.stringify(await res.json()).slice(0, 160)}`; }
            catch (_) { detail = ' (回應非 JSON)'; }
        } else {
            try { detail = ` ${(await res.text()).slice(0, 80).replace(/\s+/g, ' ')}`; } catch (_) {}
        }
        return `[OK] ${label}  HTTP ${res.status} (${ms}ms)\n   ${url}${detail}`;
    } catch (err) {
        const ms = Math.round(performance.now() - started);
        const reason = err.name === 'AbortError'
            ? `逾時 >${TEST_TIMEOUT_MS}ms`
            : `${err.name}: ${err.message}`;
        return `[FAIL] ${label}  (${ms}ms)\n   ${url}\n   ${reason}`;
    } finally {
        clearTimeout(timer);
    }
}

async function runTests() {
    const out = document.getElementById('diag-output');
    const btn = document.getElementById('diag-run');
    if (!out) return;
    if (btn) { btn.disabled = true; btn.textContent = '測試中…'; }
    out.textContent = '測試中…';

    const targets = [
        () => probe('/api/health', `${BACKEND_BASE}/api/health`, true),
    ];
    if (FIREBASE_EMULATORS.enabled) {
        targets.push(() => probe('auth emulator', `${FIREBASE_EMULATORS.authHost}/`, false));
    }

    const lines = [];
    for (const run of targets) {
        lines.push(await run());
        out.textContent = lines.join('\n\n');
    }

    if (btn) { btn.disabled = false; btn.textContent = '重新測試'; }
}

export function init() {
    register('view-more', {
        element: document.getElementById('view-more'),
        onShow: () => { renderEnv(); updateToggleUI(); },
    });

    const backBtn = document.getElementById('btn-more-back');
    if (backBtn) backBtn.onclick = () => back();

    const runBtn = document.getElementById('diag-run');
    if (runBtn) runBtn.onclick = runTests;
}
