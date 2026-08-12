// core/guest.js — 不依賴 Firebase 的本機訪客模式。
// 訪客只用裝置上的 UUID 參與即時聚會；群組、好友與雲端回顧仍需正式帳號。
import { state } from './state.js';
import { events } from './events.js';
import { switchView } from './router.js';
import { t } from './i18n.js';
import { showToast } from '../utils/toast.js';

const LOCAL_GUEST_KEY = 'phubbing_local_guest_active';
const LOCAL_GUEST_NICKNAME_KEY = 'phubbing_guest_nickname';

export function continueAsLocalGuest() {
    adoptLocalGuestIdentity();
    events.emit('guest:continued', { uid: state.guestUserId });
    showToast(t('已進入訪客模式，可直接加入聚會'), 'success');
    switchView('view-join-method');
}

export function adoptLocalGuestIdentity() {
    localStorage.setItem(LOCAL_GUEST_KEY, '1');
    state.localGuestActive = true;
    state.currentUser = null;
    state.currentProfile = null;
    state.userId = state.guestUserId;
}

export function getLocalGuestNickname() {
    if (!state.localGuestActive) return '';
    return String(localStorage.getItem(LOCAL_GUEST_NICKNAME_KEY) || '').trim().slice(0, 20);
}

export function saveLocalGuestNickname(nickname) {
    const value = String(nickname || '').trim().slice(0, 20);
    if (!value) return;
    state.localGuestActive = true;
    localStorage.setItem(LOCAL_GUEST_KEY, '1');
    localStorage.setItem(LOCAL_GUEST_NICKNAME_KEY, value);
}

export function leaveLocalGuestMode() {
    state.localGuestActive = false;
    localStorage.removeItem(LOCAL_GUEST_KEY);
}
