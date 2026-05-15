// views/invite-modal/invite-modal.js — 邀請朋友 modal + 複製連結
import { state } from '../../core/state.js';
import { apiBase } from '../../core/api.js';
import { showToast } from '../../utils/toast.js';

export function init() {
    document.getElementById('btn-invite-modal-close').onclick = closeInviteModal;
    document.getElementById('btn-invite-copy-link').onclick = copyInviteLink;

    // 點 modal 外面遮罩關閉
    const modal = document.getElementById('invite-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeInviteModal();
        });
    }
    // Esc 關閉
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeInviteModal();
        }
    });
}

export async function openInviteModal() {
    if (!state.roomId) {
        showToast('目前不在任何聚會中', 'warn');
        return;
    }
    const modal = document.getElementById('invite-modal');
    if (!modal) return;
    const dstImg = document.getElementById('invite-qr-img');
    const url = buildInviteUrl();
    if (dstImg && url) {
        const srcImg = document.getElementById('qr-code-img');
        if (srcImg && srcImg.src && srcImg.dataset.qrUrl === url) {
            dstImg.src = srcImg.src;
            dstImg.dataset.qrUrl = url;
        } else if (dstImg.dataset.qrUrl !== url) {
            try {
                const res = await fetch(`${apiBase}/api/qrcode?url=${encodeURIComponent(url)}`);
                const data = await res.json();
                if (!res.ok || data.status !== 'success') throw new Error(data.detail || 'QR Code 產生失敗');
                dstImg.src = 'data:image/png;base64,' + data.qr_base64;
                dstImg.dataset.qrUrl = url;
                if (srcImg) {
                    srcImg.src = dstImg.src;
                    srcImg.dataset.qrUrl = url;
                }
            } catch (err) {
                console.error('generate invite QR failed:', err);
                showToast('QR Code 產生失敗，請改用複製連結', 'warn');
            }
        }
    }
    modal.classList.remove('hidden');
}

export function closeInviteModal() {
    const modal = document.getElementById('invite-modal');
    if (modal) modal.classList.add('hidden');
}

function buildInviteUrl() {
    if (!state.roomId) return null;
    return `${window.location.origin}/?room=${state.roomId}`;
}

export async function copyInviteLink() {
    const url = buildInviteUrl();
    if (!url) {
        showToast('找不到聚會連結,請稍後再試', 'warn');
        return;
    }
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(url);
            showToast('🔗 聚會連結已複製到剪貼簿', 'success');
            return;
        } catch (err) {
            console.warn('clipboard.writeText failed, fallback:', err);
        }
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) showToast('🔗 聚會連結已複製到剪貼簿', 'success');
        else prompt('請手動複製連結:', url);
    } catch (err) {
        prompt('請手動複製連結:', url);
    }
}
