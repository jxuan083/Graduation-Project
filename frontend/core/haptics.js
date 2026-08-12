// core/haptics.js — Capacitor native haptics with browser fallback.

function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function getNativeHaptics() {
    return window.Capacitor?.Plugins?.Haptics || null;
}

function normalizePattern(pattern) {
    if (Array.isArray(pattern)) return pattern;
    const value = Number(pattern);
    return Number.isFinite(value) ? value : 10;
}

async function nativeVibrate(pattern) {
    const haptics = getNativeHaptics();
    if (!haptics) return false;

    const normalized = normalizePattern(pattern);
    try {
        if (Array.isArray(normalized)) {
            for (let i = 0; i < normalized.length; i += 1) {
                const ms = Number(normalized[i]) || 0;
                if (i % 2 === 0) await haptics.impact({ style: ms >= 35 ? 'MEDIUM' : 'LIGHT' });
                else await new Promise(resolve => setTimeout(resolve, ms));
            }
        } else if (normalized >= 150 && haptics.vibrate) {
            await haptics.vibrate({ duration: normalized });
        } else {
            await haptics.impact({ style: normalized >= 35 ? 'MEDIUM' : 'LIGHT' });
        }
        return true;
    } catch (_) {
        return false;
    }
}

export function vibrate(pattern = 10) {
    if (prefersReducedMotion()) return;

    nativeVibrate(pattern).then((handled) => {
        if (handled) return;
        try { navigator.vibrate?.(pattern); } catch (_) {}
    });
}

export function impact(style = 'light') {
    const normalized = String(style || 'light').toLowerCase();
    if (normalized === 'heavy') {
        vibrate(40);
    } else if (normalized === 'medium') {
        vibrate(20);
    } else {
        vibrate(8);
    }
}

// iOS 的觸覺語意分工：impact = 物體碰撞（動作按鈕）、selection = 選取項目改變
// （分頁、選擇器）、notification = 操作結果。全部震一樣等於沒有觸覺語言，
// 拇指就無法在眼睛確認之前分辨自己觸發了什麼。規格見
// docs/superpowers/specs/2026-08-05-interaction-spec.md
export function selection() {
    if (prefersReducedMotion()) return;

    const haptics = getNativeHaptics();
    if (haptics?.selectionStart) {
        Promise.resolve()
            .then(() => haptics.selectionStart())
            .then(() => haptics.selectionChanged?.())
            .then(() => haptics.selectionEnd?.())
            .catch(() => { try { navigator.vibrate?.(5); } catch (_) {} });
        return;
    }
    try { navigator.vibrate?.(5); } catch (_) {}
}

export function notificationSuccess() {
    if (prefersReducedMotion()) return;

    const haptics = getNativeHaptics();
    if (haptics?.notification) {
        haptics.notification({ type: 'SUCCESS' })
            .catch?.(() => { try { navigator.vibrate?.([30, 50, 30]); } catch (_) {} });
        return;
    }
    try { navigator.vibrate?.([30, 50, 30]); } catch (_) {}
}

export function notificationError() {
    if (prefersReducedMotion()) return;

    const haptics = getNativeHaptics();
    if (haptics?.notification) {
        haptics.notification({ type: 'ERROR' })
            .catch?.(() => { try { navigator.vibrate?.([35, 45, 35, 45, 55]); } catch (_) {} });
        return;
    }
    try { navigator.vibrate?.([35, 45, 35, 45, 55]); } catch (_) {}
}

// 底部導覽是切換目的地，語意上屬於 selection，不是 impact。
const SELECTION_SELECTOR = '.btn-bottom, .tab-btn, [role="tab"], .cp-sit-btn, .cp-level-btn, .cp-dropdown-item';

export function initButtonHaptics() {
    document.addEventListener('pointerdown', (event) => {
        const button = event.target?.closest?.('button, [role="button"], .btn, .btn-primary, .btn-secondary');
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;

        if (button.matches?.(SELECTION_SELECTOR)) {
            // 已經在目前分頁再按一次不算狀態改變，不給回饋。
            if (button.classList.contains('active') || button.classList.contains('is-current') || button.getAttribute('aria-current') === 'page') return;
            selection();
            return;
        }
        vibrate(8);
    }, { passive: true });
}
