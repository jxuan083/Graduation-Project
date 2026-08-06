// core/firebase.js — Firebase 初始化 + auth helpers
// Firebase compat SDK 用 <script> 載入,所以 `firebase` 是 window 上的全域物件

import { firebaseConfig, FIREBASE_EMULATORS, HTTP_PROTOCOL, BACKEND_HOST } from './config.js';
import { state } from './state.js';
import { events } from './events.js';
import { t } from './i18n.js';
import { showToast } from '../utils/toast.js';

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const storage = firebase.storage();
export const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');

if (FIREBASE_EMULATORS.enabled) {
    auth.useEmulator(FIREBASE_EMULATORS.authHost, { disableWarnings: true });
    storage.useEmulator(FIREBASE_EMULATORS.storageHost, FIREBASE_EMULATORS.storagePort);
}

// 取得當前可顯示的暱稱
export function getDisplayNickname() {
    if (state.currentProfile && state.currentProfile.nickname) return state.currentProfile.nickname;
    if (state.currentUser && state.currentUser.displayName) return state.currentUser.displayName;
    return '';
}

export async function getAuthHeaders() {
    if (!state.currentUser) return { 'Content-Type': 'application/json' };
    const idToken = await state.currentUser.getIdToken(false);
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
    };
}

export async function fetchMyProfile() {
    if (!state.currentUser) { state.currentProfile = null; return; }
    try {
        const res = await fetch(`${HTTP_PROTOCOL}${BACKEND_HOST}/api/me`, {
            headers: await getAuthHeaders()
        });
        const data = await res.json();
        if (data.status === 'success') {
            state.currentProfile = data.profile;
        } else {
            console.warn('fetchMyProfile failed:', data);
            state.currentProfile = null;
        }
    } catch (err) {
        console.error('fetchMyProfile error:', err);
        state.currentProfile = null;
    }
}

// 啟動 auth state 監聽 (main.js 在 boot 時呼叫一次)
export function listenAuthChanges() {
    auth.onAuthStateChanged(async (user) => {
        state.currentUser = user;
        if (user) {
            state.userId = user.uid;
            await fetchMyProfile();
            events.emit('auth:logged-in', user);
        } else {
            state.userId = state.guestUserId;
            state.currentProfile = null;
            state.friendUidSet = new Set();
            state.outgoingPendingSet = new Set();
            state.incomingPendingSet = new Set();
            events.emit('auth:logged-out');
        }
        events.emit('auth:changed', user);
    });
}

function isNativePlatform() {
    try { return Boolean(window.Capacitor?.isNativePlatform?.()); }
    catch (_) { return false; }
}

function getNativeFirebaseAuth() {
    return window.Capacitor?.Plugins?.FirebaseAuthentication || null;
}

export function readableAuthError(prefix, err) {
    const code = err?.code || '';
    const authMessages = {
        'auth/invalid-email': 'Email 格式不正確',
        'auth/weak-password': '密碼強度不足，請至少輸入 6 個字元',
        'auth/email-already-in-use': '這個 Email 已經被註冊',
        'auth/wrong-password': '密碼錯誤',
        'auth/user-not-found': '找不到這個 Email 的帳號',
        'auth/too-many-requests': '嘗試次數過多，請稍後再試',
        'auth/credential-already-in-use': '這個 Email 已經綁定到其他帳號',
    };
    const detail = authMessages[code] ? t(authMessages[code]) : (err?.message || code || String(err || ''));
    return detail ? `${prefix}${detail}` : prefix;
}

async function refreshSignedInUser(user) {
    if (!user) return;
    state.currentUser = user;
    state.userId = user.uid;
    await fetchMyProfile();
    events.emit('auth:logged-in', user);
    events.emit('auth:changed', user);
}

async function doNativeGoogleLogin() {
    const nativeAuth = getNativeFirebaseAuth();
    if (!nativeAuth?.signInWithGoogle) {
        throw new Error('原生 Google 登入套件尚未載入，請先執行 npx cap sync ios 並重新安裝 app。');
    }

    const result = await nativeAuth.signInWithGoogle({ skipNativeAuth: true });
    const credentialData = result?.credential || {};
    if (!credentialData.idToken && !credentialData.accessToken) {
        throw new Error('Google 沒有回傳可交給 Firebase 的登入憑證，請確認 iOS GoogleService-Info.plist 與 URL scheme 已設定。');
    }
    const credential = firebase.auth.GoogleAuthProvider.credential(
        credentialData.idToken || null,
        credentialData.accessToken || null
    );
    await auth.signInWithCredential(credential);
}

export async function doGoogleLogin() {
    try {
        if (isNativePlatform()) {
            await doNativeGoogleLogin();
        } else {
            await auth.signInWithPopup(googleProvider);
        }
    } catch (err) {
        console.error('Google sign-in failed:', err);
        showToast(readableAuthError(t('Google 登入失敗：'), err), 'error');
    }
}

// 快速登入 = Firebase 匿名驗證。刻意選它的原因：匿名登入不需要開 popup 或
// 跳出 OAuth 網頁，所以在 Capacitor 的 WKWebView 裡可以直接用，不像
// signInWithPopup 會被 Google 擋掉。後端 verify_token 只要求 token 有 uid，
// 匿名 token 也有，users/{uid} 會自動建立，不必改後端。
export async function doQuickLogin() {
    try {
        const credential = await auth.signInAnonymously();
        if (credential?.user && !credential.user.displayName) {
            await credential.user.updateProfile({ displayName: t('訪客') });
        }
    } catch (err) {
        console.error('Anonymous sign-in failed:', err);
        showToast(readableAuthError(t('快速登入失敗：'), err), 'error');
    }
}

export async function doLocalDevLogin() {
    if (!FIREBASE_EMULATORS.enabled) {
        showToast(t('本機快速登入只會在 Firebase emulator 開發環境顯示。'), 'error');
        return;
    }
    const suffix = localStorage.getItem('phubbing_dev_user_suffix') || String(Date.now()).slice(-6);
    localStorage.setItem('phubbing_dev_user_suffix', suffix);
    const email = `local-${suffix}@phubbing.test`;
    const password = 'local-dev-password';
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
            const credential = await auth.createUserWithEmailAndPassword(email, password);
            await credential.user.updateProfile({ displayName: '本機測試成員' });
            await fetchMyProfile();
            events.emit('auth:logged-in', credential.user);
            events.emit('auth:changed', credential.user);
            return;
        }
        console.error('Local dev sign-in failed:', err);
        showToast(readableAuthError(t('本機登入失敗：'), err), 'error');
    }
}

export async function doEmailSignIn(email, password) {
    try {
        return await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
        console.error('Email sign-in failed:', err);
        showToast(readableAuthError(t('Email 登入失敗：'), err), 'error');
        return null;
    }
}

export async function doEmailSignUp(email, password, displayName) {
    const nickname = String(displayName || '').trim();
    try {
        const currentUser = auth.currentUser;
        if (currentUser?.isAnonymous) {
            const credential = firebase.auth.EmailAuthProvider.credential(email, password);
            const result = await currentUser.linkWithCredential(credential);
            if (nickname) await result.user.updateProfile({ displayName: nickname });
            await refreshSignedInUser(result.user);
            return result;
        }

        const result = await auth.createUserWithEmailAndPassword(email, password);
        if (nickname) await result.user.updateProfile({ displayName: nickname });
        await refreshSignedInUser(result.user);
        return result;
    } catch (err) {
        console.error('Email sign-up failed:', err);
        showToast(readableAuthError(t('Email 註冊失敗：'), err), 'error');
        return null;
    }
}

export async function doPasswordReset(email) {
    try {
        await auth.sendPasswordResetEmail(email);
        showToast(t('重設密碼信已寄出'), 'success');
        return true;
    } catch (err) {
        console.error('Password reset failed:', err);
        showToast(readableAuthError(t('重設密碼失敗：'), err), 'error');
        return false;
    }
}

export async function doSignOut() {
    try {
        await auth.signOut();
    } catch (err) {
        console.error('Sign-out failed:', err);
    }
}
