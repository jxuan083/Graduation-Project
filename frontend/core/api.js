// core/api.js — REST API 封裝 + 後端版本載入
import { HTTP_PROTOCOL, BACKEND_HOST } from './config.js';
import { getAuthHeaders } from './firebase.js';

export const apiBase = `${HTTP_PROTOCOL}${BACKEND_HOST}`;

// 統一 fetch 封裝,加上 auth header 並 parse JSON
export async function apiFetch(path, options = {}) {
    const headers = await getAuthHeaders();
    const res = await fetch(apiBase + path, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) }
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not json */ }
    return { res, data };
}

export async function loadBackendVersion() {
    const footerEl = document.getElementById('footer-version');
    if (!footerEl) return;
    try {
        const res = await fetch(`${apiBase}/api/version`);
        const data = await res.json();
        const v = data.version || '?';
        const d = data.build_date || '';
        footerEl.innerText = d ? `Phubbing Anchor · ${v} · ${d}` : `Phubbing Anchor · ${v}`;
    } catch (err) {
        console.warn('load version failed:', err);
        footerEl.innerText = 'Phubbing Anchor · offline';
    }
}
