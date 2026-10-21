// core/auth.js — Amazon Cognito 登入 + auth helpers（取代原本的 Firebase Auth）
// 直接打 Cognito 的 HTTP API，不載入 SDK。Email/密碼走 USER_PASSWORD_AUTH，
// Google 走 Cognito 登入頁（OAuth code + PKCE），回到本站後換 token。
// state.currentUser 仍是 { uid, email, displayName, photoURL, getIdToken() }，其他模組不用改。

import { COGNITO, HTTP_PROTOCOL, BACKEND_HOST } from './config.js';
import { state } from './state.js';
import { events } from './events.js';
import { t } from './i18n.js';
import { showToast } from '../utils/toast.js';
import { getLocalGuestNickname, leaveLocalGuestMode } from './guest.js?v=77';

const SESSION_KEY = 'phubbing_cognito_session';
const PKCE_KEY = 'phubbing_cognito_pkce';
const IDP_URL = `https://cognito-idp.${COGNITO.region}.amazonaws.com/`;

// ===== Cognito API =====
async function cognito(action, body) {
    const res = await fetch(IDP_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.message || `${action} failed`);
        err.code = String(data.__type || '').split('#').pop();
        throw err;
    }
    return data;
}

function decodeJwt(token) {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
}

function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
}

function saveSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
}

function sessionFromTokens(idToken, expiresIn, refreshToken) {
    return { idToken, refreshToken, expiresAt: Date.now() + Number(expiresIn || 3600) * 1000 };
}

async function getFreshIdToken(forceRefresh = false) {
    const session = loadSession();
    if (!session) throw new Error('未登入');
    if (!forceRefresh && session.expiresAt - 60_000 > Date.now()) return session.idToken;
    try {
        const data = await cognito('InitiateAuth', {
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: COGNITO.clientId,
            AuthParameters: { REFRESH_TOKEN: session.refreshToken },
        });
        const r = data.AuthenticationResult;
        saveSession(sessionFromTokens(r.IdToken, r.ExpiresIn, r.RefreshToken || session.refreshToken));
        return r.IdToken;
    } catch (err) {
        // refresh token 過期或被撤銷 → 視為登出
        await setSession(null);
        throw err;
    }
}

function userFromSession(session) {
    if (!session) return null;
    const claims = decodeJwt(session.idToken);
    return {
        uid: claims.sub,
        email: claims.email || '',
        displayName: claims.name || '',
        photoURL: claims.picture || '',
        getIdToken: getFreshIdToken,
    };
}

// ===== 登入狀態變化（取代 onAuthStateChanged）=====
async function applyUser(user) {
    state.currentUser = user;
    if (user) {
        leaveLocalGuestMode();
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
}

async function setSession(session) {
    saveSession(session);
    const user = userFromSession(session);
    await applyUser(user);
    return user;
}

// 取得當前可顯示的暱稱
export function getDisplayNickname() {
    if (state.currentProfile && state.currentProfile.nickname) return state.currentProfile.nickname;
    if (state.currentUser && state.currentUser.displayName) return state.currentUser.displayName;
    const localGuestNickname = getLocalGuestNickname();
    if (localGuestNickname) return localGuestNickname;
    return '';
}

export async function getAuthHeaders() {
    if (!state.currentUser) {
        const headers = { 'Content-Type': 'application/json' };
        if (state.localGuestActive && state.guestUserId) headers['X-Guest-Uid'] = state.guestUserId;
        return headers;
    }
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

// 啟動時呼叫一次 (main.js)：先處理 Google 登入回跳，再還原已儲存的登入狀態
export async function listenAuthChanges() {
    try {
        if (await handleOAuthRedirect()) return;
    } catch (err) {
        console.error('OAuth redirect failed:', err);
        showToast(readableAuthError(t('Google 登入失敗：'), err), 'error');
    }
    const session = loadSession();
    await applyUser(userFromSession(session));
}

export function readableAuthError(prefix, err) {
    const code = err?.code || '';
    const authMessages = {
        InvalidParameterException: 'Email 格式不正確',
        InvalidPasswordException: '密碼強度不足，請至少輸入 6 個字元',
        UsernameExistsException: '這個 Email 已經被註冊',
        NotAuthorizedException: 'Email 或密碼錯誤',
        UserNotFoundException: '找不到這個 Email 的帳號',
        TooManyRequestsException: '嘗試次數過多，請稍後再試',
        LimitExceededException: '嘗試次數過多，請稍後再試',
    };
    const detail = authMessages[code] ? t(authMessages[code]) : (err?.message || code || String(err || ''));
    return detail ? `${prefix}${detail}` : prefix;
}

// ===== Google / Cognito 登入頁（OAuth code + PKCE）=====
function base64Url(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function oauthRedirectUri() {
    return `${window.location.origin}/`;
}

async function redirectToHostedUi(path, extraParams = {}) {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const oauthState = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state: oauthState }));
    const params = new URLSearchParams({
        client_id: COGNITO.clientId,
        response_type: 'code',
        scope: 'openid email profile',
        redirect_uri: oauthRedirectUri(),
        state: oauthState,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...extraParams,
    });
    window.location.assign(`https://${COGNITO.domain}${path}?${params}`);
}

async function handleOAuthRedirect() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    if (!code || !returnedState) return false;
    const pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    if (!pkce || pkce.state !== returnedState) return false;  // 不是我們發起的回跳，當一般網址處理
    sessionStorage.removeItem(PKCE_KEY);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);

    const res = await fetch(`https://${COGNITO.domain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: COGNITO.clientId,
            code,
            redirect_uri: oauthRedirectUri(),
            code_verifier: pkce.verifier,
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    await setSession(sessionFromTokens(data.id_token, data.expires_in, data.refresh_token));
    return true;
}

export async function doGoogleLogin() {
    try {
        await redirectToHostedUi('/oauth2/authorize', { identity_provider: 'Google' });
    } catch (err) {
        console.error('Google sign-in failed:', err);
        showToast(readableAuthError(t('Google 登入失敗：'), err), 'error');
    }
}

// ===== Email / 密碼 =====
async function signInWithPassword(email, password) {
    const data = await cognito('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: COGNITO.clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    const r = data.AuthenticationResult;
    return setSession(sessionFromTokens(r.IdToken, r.ExpiresIn, r.RefreshToken));
}

export async function doEmailSignIn(email, password) {
    try {
        return { user: await signInWithPassword(email, password) };
    } catch (err) {
        console.error('Email sign-in failed:', err);
        showToast(readableAuthError(t('Email 登入失敗：'), err), 'error');
        return null;
    }
}

export async function doEmailSignUp(email, password, displayName) {
    const nickname = String(displayName || '').trim();
    try {
        // user pool 的 pre-sign-up trigger 會自動確認帳號，所以註冊完可以直接登入
        await cognito('SignUp', {
            ClientId: COGNITO.clientId,
            Username: email,
            Password: password,
            UserAttributes: [
                { Name: 'email', Value: email },
                ...(nickname ? [{ Name: 'name', Value: nickname }] : []),
            ],
        });
        return { user: await signInWithPassword(email, password) };
    } catch (err) {
        console.error('Email sign-up failed:', err);
        showToast(readableAuthError(t('Email 註冊失敗：'), err), 'error');
        return null;
    }
}

// Cognito 的重設流程是寄驗證碼；直接用 Cognito 登入頁的忘記密碼畫面處理，重設完會帶回本站並登入
export async function doPasswordReset(email) {
    try {
        await redirectToHostedUi('/forgotPassword', email ? { login_hint: email } : {});
        return true;
    } catch (err) {
        console.error('Password reset failed:', err);
        showToast(readableAuthError(t('重設密碼失敗：'), err), 'error');
        return false;
    }
}

export async function doSignOut() {
    try {
        await setSession(null);
    } catch (err) {
        console.error('Sign-out failed:', err);
    }
}
