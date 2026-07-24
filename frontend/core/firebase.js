// core/firebase.js — Firebase 初始化 + auth helpers
// Firebase compat SDK 用 <script> 載入,所以 `firebase` 是 window 上的全域物件

import { firebaseConfig, FIREBASE_EMULATORS, HTTP_PROTOCOL, BACKEND_HOST } from './config.js';
import { state } from './state.js';
import { events } from './events.js';
import { t } from './i18n.js';

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const storage = firebase.storage();
export const googleProvider = new firebase.auth.GoogleAuthProvider();

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

export async function doGoogleLogin() {
    try {
        await auth.signInWithPopup(googleProvider);
    } catch (err) {
        console.error('Google sign-in failed:', err);
        alert(t('Google 登入失敗:') + (err.message || err));
    }
}

export async function doLocalDevLogin() {
    if (!FIREBASE_EMULATORS.enabled) return;
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
        alert(t('本機登入失敗:') + (err.message || err));
    }
}

export async function doSignOut() {
    try {
        await auth.signOut();
    } catch (err) {
        console.error('Sign-out failed:', err);
    }
}
