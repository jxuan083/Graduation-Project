// core/api.js — REST API 封裝 + 後端版本載入
import { HTTP_PROTOCOL, BACKEND_HOST } from './config.js';
import { getAuthHeaders } from './firebase.js';

export const apiBase = `${HTTP_PROTOCOL}${BACKEND_HOST}`;

// 統一 fetch 封裝,加上 auth header 並 parse JSON
export async function apiFetch(path, options = {}) {
    const headers = await getAuthHeaders();
    const mergedHeaders = { ...headers, ...(options.headers || {}) };
    if (options.body instanceof FormData) {
        delete mergedHeaders['Content-Type'];
        delete mergedHeaders['content-type'];
    }
    const res = await fetch(apiBase + path, {
        ...options,
        headers: mergedHeaders
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not json */ }
    return { res, data };
}

const protectedImageUrls = new WeakMap();

// 聚會照片是 private blob；先帶 Firebase ID token 取回，再用本機 object URL 顯示。
export async function setProtectedImage(element, path, { background = false } = {}) {
    if (!element || !path) return false;
    const headers = await getAuthHeaders();
    const res = await fetch(apiBase + path, { headers });
    if (!res.ok) throw new Error(`讀取圖片失敗 (HTTP ${res.status})`);
    const objectUrl = URL.createObjectURL(await res.blob());
    const previous = protectedImageUrls.get(element);
    if (previous) URL.revokeObjectURL(previous);
    protectedImageUrls.set(element, objectUrl);
    if (background) element.style.backgroundImage = `url("${objectUrl}")`;
    else element.src = objectUrl;
    return true;
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
