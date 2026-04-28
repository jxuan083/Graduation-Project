// core/firebase.js — Firebase 初始化 + auth helpers
// Firebase compat SDK 用 <script> 載入,所以 `firebase` 是 window 上的全域物件

import { firebaseConfig, HTTP_PROTOCOL, BACKEND_HOST } from './config.js';
import { state } from './state.js';
import { events } from './events.js';

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const storage = firebase.storage();
export const googleProvider = new firebase.auth.GoogleAuthProvider();

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
        alert('Google 登入失敗:' + (err.message || err));
    }
}

export async function doSignOut() {
    try {
        await auth.signOut();
    } catch (err) {
        console.error('Sign-out failed:', err);
    }
}
