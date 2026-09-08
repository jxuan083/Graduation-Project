// core/feedback.js — 共用互動回饋引擎：視覺、無障礙語意與觸覺保持同步。
import { impact, notificationError, notificationSuccess } from './haptics.js?v=62';

const PRESSABLE_SELECTOR = [
    '.btn-primary',
    '.btn-secondary',
    '.btn-auth',
    '.guest-primary-action',
    '.login-sheet-option',
    '.join-method-primary',
    '.cp-mode-btn',
    '.cp-sit-btn',
    '.cp-dropdown-btn',
].join(',');

const buttonSnapshots = new WeakMap();

export function initInteractionFeedback() {
    document.addEventListener('pointerdown', (event) => {
        const target = event.target?.closest?.(PRESSABLE_SELECTOR);
        if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;

        const rect = target.getBoundingClientRect();
        const horizontalShift = event.clientX < rect.left + rect.width / 2 ? '-2px' : '2px';
        target.style.setProperty('--press-shift-x', horizontalShift);
    }, { passive: true });
}

export function setButtonPending(button, label) {
    if (!button) return;
    ensureButtonSnapshot(button);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.remove('is-feedback-success', 'is-feedback-error');
    button.classList.add('is-feedback-pending');
    button.innerHTML = `<span class="feedback-equalizer" aria-hidden="true"><i></i><i></i><i></i></span><span>${escapeHtml(label)}</span>`;
    impact('medium');
}

export function setButtonSuccess(button, label, { restoreAfter = 900 } = {}) {
    if (!button) return;
    ensureButtonSnapshot(button);
    button.classList.remove('is-feedback-pending', 'is-feedback-error');
    button.classList.add('is-feedback-success');
    button.removeAttribute('aria-busy');
    button.innerHTML = `<i data-lucide="check" aria-hidden="true"></i><span>${escapeHtml(label)}</span>`;
    window.lucide?.createIcons?.();
    notificationSuccess();
    if (restoreAfter > 0) window.setTimeout(() => restoreButton(button), restoreAfter);
}

export function setButtonError(button, label, { restoreAfter = 1400 } = {}) {
    if (!button) return;
    ensureButtonSnapshot(button);
    button.classList.remove('is-feedback-pending', 'is-feedback-success');
    button.classList.add('is-feedback-error');
    button.removeAttribute('aria-busy');
    button.innerHTML = `<i data-lucide="circle-alert" aria-hidden="true"></i><span>${escapeHtml(label)}</span>`;
    window.lucide?.createIcons?.();
    notificationError();
    if (restoreAfter > 0) window.setTimeout(() => restoreButton(button), restoreAfter);
}

export function restoreButton(button) {
    const snapshot = buttonSnapshots.get(button);
    if (!button || !snapshot) return;
    button.innerHTML = snapshot.html;
    button.disabled = snapshot.disabled;
    button.removeAttribute('aria-busy');
    button.classList.remove('is-feedback-pending', 'is-feedback-success', 'is-feedback-error');
    buttonSnapshots.delete(button);
    window.lucide?.createIcons?.();
}

function ensureButtonSnapshot(button) {
    if (buttonSnapshots.has(button)) return;
    buttonSnapshots.set(button, {
        html: button.innerHTML,
        disabled: button.disabled,
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}
