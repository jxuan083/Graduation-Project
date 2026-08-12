// core/login-sheet.js — reusable login method bottom sheet.
import { FIREBASE_EMULATORS, IS_NATIVE_APP } from './config.js';
import { doEmailSignIn, doEmailSignUp, doGoogleLogin, doLocalDevLogin, doPasswordReset } from './firebase.js?v=57';
import { continueAsLocalGuest } from './guest.js?v=57';
import { impact } from './haptics.js?v=57';
import { applyTo, t } from './i18n.js';
import { showToast } from '../utils/toast.js';

const SHEET_ID = 'login-method-sheet';
let sheetRoot = null;
let lastFocusedElement = null;
let emailMode = 'signin';
let emailSubmitting = false;

// Add future providers by appending config entries here. Keep rendering generic:
// no provider-specific layout logic should be needed for Apple or email login.
const LOGIN_METHOD_OPTIONS = [
    {
        id: 'google',
        label: '使用 Google 繼續',
        icon: 'chrome',
        disabled: () => IS_NATIVE_APP,
        disabledLabel: () => IS_NATIVE_APP ? 'App 版本尚未支援' : '',
        reason: () => IS_NATIVE_APP ? 'App 版本尚未支援 Google 登入，請先使用網頁版。' : '',
        action: doGoogleLogin,
    },
    {
        id: 'email',
        label: '使用 Email 繼續',
        icon: 'mail',
        action: () => renderEmailForm('signin'),
        keepSheetOpen: true,
    },
    {
        id: 'apple',
        label: '使用 Apple 繼續',
        icon: 'apple',
        disabled: () => true,
        disabledLabel: () => '即將推出',
        reason: () => 'Apple 登入即將推出。',
        // Future Apple Sign-In handler goes here when the native capability exists.
    },
    {
        id: 'local-dev',
        label: '本機快速登入',
        icon: 'terminal',
        note: () => '僅 Firebase emulator',
        renderWhen: () => FIREBASE_EMULATORS.enabled,
        action: doLocalDevLogin,
    },
    {
        id: 'anonymous',
        // 真正的本機訪客：不建立 Firebase 帳號，只帶裝置 UUID 進入聚會。
        label: '以本機訪客繼續',
        icon: 'user-round',
        note: () => '不需帳號，可直接加入聚會',
        action: continueAsLocalGuest,
    },
];

export function openLoginMethodSheet() {
    ensureSheet();
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    renderOptions();
    sheetRoot.hidden = false;
    sheetRoot.setAttribute('aria-hidden', 'false');
    document.body.classList.add('login-method-sheet-open');
    requestAnimationFrame(() => {
        sheetRoot.classList.add('is-open');
        sheetRoot.querySelector('.login-sheet-close')?.focus();
    });
}

function ensureSheet() {
    if (sheetRoot) return;

    sheetRoot = document.createElement('div');
    sheetRoot.id = SHEET_ID;
    sheetRoot.className = 'login-method-sheet';
    sheetRoot.hidden = true;
    sheetRoot.setAttribute('aria-hidden', 'true');
    sheetRoot.innerHTML = `
        <div class="login-sheet-backdrop" data-login-sheet-close></div>
        <section class="login-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="login-sheet-title">
            <div class="login-sheet-grabber" aria-hidden="true"></div>
            <div class="login-sheet-header">
                <div>
                    <h2 id="login-sheet-title" class="login-sheet-title">選擇登入方式</h2>
                    <p class="login-sheet-subtitle">登入後可保存群組與聚會回顧。</p>
                </div>
                <button class="login-sheet-close" type="button" aria-label="關閉登入選單" data-login-sheet-close>
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div class="login-sheet-options" role="list"></div>
            <p class="login-sheet-message" role="status" aria-live="polite"></p>
        </section>
    `;

    sheetRoot.addEventListener('click', handleSheetClick);
    sheetRoot.addEventListener('submit', handleSheetSubmit);
    document.addEventListener('keydown', handleKeydown);
    document.getElementById('app-container')?.appendChild(sheetRoot);
    applyTo(sheetRoot);
    if (window.lucide) window.lucide.createIcons();
}

function renderOptions() {
    const list = sheetRoot.querySelector('.login-sheet-options');
    const message = sheetRoot.querySelector('.login-sheet-message');
    if (!list || !message) return;
    setSheetHeader('選擇登入方式', '登入後可保存群組與聚會回顧。');
    emailSubmitting = false;
    message.textContent = '';
    list.innerHTML = '';
    list.setAttribute('role', 'list');

    LOGIN_METHOD_OPTIONS
        .filter((option) => option.renderWhen ? option.renderWhen() : true)
        .forEach((option) => {
            const disabled = Boolean(option.disabled?.());
            const button = document.createElement('button');
            button.className = 'login-sheet-option';
            button.type = 'button';
            button.dataset.loginOptionId = option.id;
            button.setAttribute('role', 'listitem');
            if (disabled) {
                button.classList.add('is-disabled');
                button.setAttribute('aria-disabled', 'true');
            } else {
                button.setAttribute('aria-disabled', 'false');
            }

            const metaText = disabled ? option.disabledLabel?.() : option.note?.();
            button.innerHTML = `
                <span class="login-sheet-option-icon" aria-hidden="true"><i data-lucide="${option.icon}"></i></span>
                <span class="login-sheet-option-copy">
                    <span class="login-sheet-option-label"></span>
                    ${metaText ? '<span class="login-sheet-option-meta"></span>' : ''}
                </span>
            `;
            button.querySelector('.login-sheet-option-label').textContent = option.label;
            const meta = button.querySelector('.login-sheet-option-meta');
            if (meta) meta.textContent = metaText;
            list.appendChild(button);
        });

    applyTo(list);
    if (window.lucide) window.lucide.createIcons();
}

function renderEmailForm(mode = emailMode) {
    const list = sheetRoot.querySelector('.login-sheet-options');
    const message = sheetRoot.querySelector('.login-sheet-message');
    if (!list || !message) return;

    emailMode = mode === 'signup' ? 'signup' : 'signin';
    emailSubmitting = false;
    setSheetHeader(
        emailMode === 'signup' ? '建立 Email 帳號' : '使用 Email 登入',
        emailMode === 'signup' ? '註冊後會保留目前裝置上的訪客資料。' : '輸入 Email 與密碼繼續使用。'
    );
    message.textContent = '';
    list.removeAttribute('role');
    list.innerHTML = `
        <form class="login-email-form" data-login-email-form novalidate>
            <button class="login-email-back" type="button" data-login-email-back>
                <i data-lucide="chevron-left" aria-hidden="true"></i>
                <span>返回登入方式</span>
            </button>
            <div class="login-email-mode" role="tablist" aria-label="Email 登入模式">
                <button class="login-email-mode-btn" type="button" role="tab" data-email-mode="signin">登入</button>
                <button class="login-email-mode-btn" type="button" role="tab" data-email-mode="signup">註冊</button>
            </div>
            <label class="login-email-field">
                <span>Email</span>
                <input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="name@example.com">
            </label>
            <label class="login-email-field" data-signup-name-field>
                <span>暱稱</span>
                <input name="displayName" type="text" autocomplete="nickname" maxlength="40" placeholder="輸入一個暱稱讓大家認得你">
            </label>
            <label class="login-email-field">
                <span>密碼</span>
                <input name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="至少 6 個字元">
            </label>
            <button class="login-email-submit" type="submit" data-login-email-submit></button>
            <button class="login-email-reset" type="button" data-login-email-reset>忘記密碼？</button>
        </form>
    `;
    syncEmailFormState();
    applyTo(list);
    if (window.lucide) window.lucide.createIcons();
    requestAnimationFrame(() => list.querySelector('input[name="email"]')?.focus());
}

function setSheetHeader(title, subtitle) {
    const titleEl = sheetRoot.querySelector('.login-sheet-title');
    const subtitleEl = sheetRoot.querySelector('.login-sheet-subtitle');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
    applyTo(sheetRoot.querySelector('.login-sheet-header'));
}

function syncEmailFormState() {
    const form = sheetRoot.querySelector('[data-login-email-form]');
    if (!form) return;
    const isSignup = emailMode === 'signup';
    form.dataset.mode = emailMode;
    form.querySelector('[data-signup-name-field]').hidden = !isSignup;
    const password = form.elements.password;
    if (password) password.autocomplete = isSignup ? 'new-password' : 'current-password';

    form.querySelectorAll('[data-email-mode]').forEach((button) => {
        const active = button.dataset.emailMode === emailMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const submit = form.querySelector('[data-login-email-submit]');
    if (submit) {
        submit.disabled = emailSubmitting;
        submit.textContent = emailSubmitting
            ? (isSignup ? '註冊中…' : '登入中…')
            : (isSignup ? '建立帳號' : '登入');
        applyTo(submit);
    }
}

function handleSheetClick(event) {
    const closeTarget = event.target.closest('[data-login-sheet-close]');
    if (closeTarget) {
        closeLoginMethodSheet();
        return;
    }

    const button = event.target.closest('[data-login-option-id]');
    const backButton = event.target.closest('[data-login-email-back]');
    if (backButton) {
        impact('light');
        renderOptions();
        return;
    }

    const modeButton = event.target.closest('[data-email-mode]');
    if (modeButton) {
        impact('light');
        emailMode = modeButton.dataset.emailMode === 'signup' ? 'signup' : 'signin';
        syncEmailFormState();
        return;
    }

    const resetButton = event.target.closest('[data-login-email-reset]');
    if (resetButton) {
        handlePasswordReset();
        return;
    }

    if (!button) return;
    const option = LOGIN_METHOD_OPTIONS.find((item) => item.id === button.dataset.loginOptionId);
    if (!option) return;

    impact('light');
    const disabled = button.getAttribute('aria-disabled') === 'true';
    if (disabled) {
        showDisabledReason(option);
        return;
    }

    if (!option.keepSheetOpen) closeLoginMethodSheet();
    option.action?.();
}

async function handleSheetSubmit(event) {
    const form = event.target.closest('[data-login-email-form]');
    if (!form) return;
    event.preventDefault();
    if (emailSubmitting) return;

    const email = String(form.elements.email?.value || '').trim();
    const password = String(form.elements.password?.value || '');
    const displayName = String(form.elements.displayName?.value || '').trim();
    if (!email || !password) {
        showToast(t('請輸入 Email 與密碼'), 'error');
        return;
    }

    emailSubmitting = true;
    impact('medium');
    syncEmailFormState();
    const result = emailMode === 'signup'
        ? await doEmailSignUp(email, password, displayName)
        : await doEmailSignIn(email, password);
    emailSubmitting = false;
    syncEmailFormState();
    if (result?.user) closeLoginMethodSheet();
}

async function handlePasswordReset() {
    const form = sheetRoot.querySelector('[data-login-email-form]');
    const emailInput = form?.elements.email;
    const email = String(emailInput?.value || '').trim();
    if (!email) {
        showToast(t('請先輸入 Email'), 'error');
        emailInput?.focus();
        return;
    }
    impact('medium');
    await doPasswordReset(email);
}

function showDisabledReason(option) {
    const reason = option.reason?.() || option.disabledLabel?.();
    if (!reason) return;
    const message = sheetRoot.querySelector('.login-sheet-message');
    if (message) {
        message.textContent = reason;
        applyTo(message);
    }
    showToast(t(reason), 'error');
}

function handleKeydown(event) {
    if (!sheetRoot || sheetRoot.hidden || event.key !== 'Escape') return;
    closeLoginMethodSheet();
}

function closeLoginMethodSheet() {
    if (!sheetRoot || sheetRoot.hidden) return;
    sheetRoot.classList.remove('is-open');
    sheetRoot.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('login-method-sheet-open');

    const finish = () => {
        sheetRoot.hidden = true;
        lastFocusedElement?.focus?.();
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        finish();
    } else {
        sheetRoot.querySelector('.login-sheet-panel')?.addEventListener('transitionend', finish, { once: true });
        window.setTimeout(() => {
            if (!sheetRoot.hidden && sheetRoot.getAttribute('aria-hidden') === 'true') finish();
        }, 360);
    }
}
