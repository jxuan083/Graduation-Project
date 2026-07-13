// views/friends/friends.js — 好友頁（front-preview 改版：三分頁 + 加好友三模式）
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { apiFetch } from '../../core/api.js';
import { goHomeFromMenu } from '../../core/session.js';
import { events } from '../../core/events.js';
import { t } from '../../core/i18n.js';
import { showToast } from '../../utils/toast.js';
import {
    acceptFriendRequest,
    declineFriendRequest,
    withdrawFriendRequest,
} from '../../features/friends/controller.js';

const FRIEND_TABS = ['list', 'incoming', 'add'];
let afScanner = null;

export function init() {
    register('view-friends', {
        element: document.getElementById('view-friends'),
        onHide: stopAfScanner,
    });

    document.getElementById('btn-friends-back').onclick = () => { stopAfScanner(); goHomeFromMenu(); };
    document.getElementById('friends-tab-list').onclick = () => { switchFriendTab('list'); refreshFriends(); };
    document.getElementById('friends-tab-incoming').onclick = () => { switchFriendTab('incoming'); refreshFriendRequests(); };
    document.getElementById('friends-tab-add').onclick = () => { switchFriendTab('add'); showAddMode('select'); };

    document.getElementById('friend-search').addEventListener('input', (e) => filterFriends(e.target.value));

    // 加好友三模式
    document.getElementById('af-qr-mode').onclick = () => showAddMode('qr');
    document.getElementById('af-search-mode').onclick = () => showAddMode('search');
    document.getElementById('af-myqr-mode').onclick = () => showAddMode('myqr');
    document.getElementById('af-qr-back').onclick = () => showAddMode('select');
    document.getElementById('af-search-back').onclick = () => showAddMode('select');
    document.getElementById('af-myqr-back').onclick = () => showAddMode('select');
    document.getElementById('af-search-btn').onclick = handleIdSearch;
    document.getElementById('af-id-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleIdSearch(); });
    document.getElementById('af-myqr-share').onclick = shareMyId;

    events.on('friends:changed', () => {
        if (document.getElementById('view-friends').classList.contains('active')) {
            refreshFriends();
            refreshFriendRequests();
        }
    });
}

export function openFriendsView(initialTab) {
    if (!state.currentUser) { alert(t('請先登入')); return; }
    switchView('view-friends');
    const tab = FRIEND_TABS.includes(initialTab) ? initialTab : 'list';
    switchFriendTab(tab);
    refreshFriends();
    refreshFriendRequests();
    if (tab === 'add') showAddMode('select');
}

function switchFriendTab(tab) {
    stopAfScanner();
    document.getElementById('friends-tab-list').classList.toggle('active', tab === 'list');
    document.getElementById('friends-tab-incoming').classList.toggle('active', tab === 'incoming');
    document.getElementById('friends-tab-add').classList.toggle('active', tab === 'add');
    document.getElementById('friends-panel-my').style.display = (tab === 'list') ? 'flex' : 'none';
    document.getElementById('friends-panel-requests').style.display = (tab === 'incoming') ? 'flex' : 'none';
    document.getElementById('friends-panel-add').style.display = (tab === 'add') ? 'flex' : 'none';
}

// ── 我的好友 ──
async function refreshFriends() {
    if (!state.currentUser) return;
    const listEl = document.getElementById('friend-list');
    const emptyHint = document.getElementById('friends-empty-hint');
    listEl.innerHTML = `<p class="hint">${t('載入中…')}</p>`;
    try {
        const { data } = await apiFetch('/api/friends');
        const friends = (data && data.friends) || [];
        state.friendUidSet = new Set(friends.map(f => f.uid));
        document.getElementById('friends-count').innerText = friends.length;
        if (!friends.length) {
            listEl.innerHTML = '';
            emptyHint.style.display = 'block';
            return;
        }
        emptyHint.style.display = 'none';
        listEl.innerHTML = friends.map(f => {
            const name = escHtml(f.nickname_snapshot || f.uid);
            const photo = f.avatar_snapshot || '';
            const av = photo
                ? `<div class="friend-avatar" style="width:48px;height:48px;overflow:hidden;"><img src="${escAttr(photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
                : `<div class="friend-avatar" style="width:48px;height:48px;background:var(--brown-10);">${escHtml((f.nickname_snapshot || f.uid || '?')[0].toUpperCase())}</div>`;
            const sub = relLastSeen(f.last_seen);
            const subHtml = sub ? `<p class="friend-sub">${escHtml(sub)}</p>` : '';
            return `<button class="friend-row" data-uid="${escAttr(f.uid)}" data-name="${name}">
                ${av}<div style="flex:1;text-align:left;"><p class="friend-name">${name}</p>${subHtml}</div>
            </button>`;
        }).join('');
        listEl.querySelectorAll('.friend-row').forEach(row => {
            row.onclick = () => openFriendProfile(row.dataset.uid);
        });
    } catch (err) {
        console.error(err);
        listEl.innerHTML = `<p class="hint error">${t('讀取好友列表失敗')}</p>`;
    }
}

function filterFriends(qRaw) {
    const q = (qRaw || '').trim().toLowerCase();
    document.querySelectorAll('#friend-list .friend-row').forEach(row => {
        const name = (row.dataset.name || '').toLowerCase();
        row.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
}

// ── 好友請求 ──
async function refreshFriendRequests() {
    if (!state.currentUser) return;
    const inEl = document.getElementById('fr-incoming-list');
    const inEmpty = document.getElementById('fr-incoming-empty');
    const outEl = document.getElementById('fr-outgoing-list');
    const outEmpty = document.getElementById('fr-outgoing-empty');
    inEl.innerHTML = `<p class="hint">${t('載入中…')}</p>`;
    outEl.innerHTML = '';
    try {
        const { data } = await apiFetch('/api/friend_requests');
        const incoming = (data && data.incoming) || [];
        const outgoing = (data && data.outgoing) || [];
        state.outgoingPendingSet = new Set(outgoing.map(r => r.other_uid));
        state.incomingPendingSet = new Set(incoming.map(r => r.other_uid));
        document.getElementById('friends-incoming-count').innerText = incoming.length;
        const cnt2 = document.getElementById('friends-incoming-count2');
        if (cnt2) cnt2.innerText = incoming.length;

        inEl.innerHTML = '';
        inEmpty.style.display = incoming.length ? 'none' : 'block';
        incoming.forEach(r => inEl.appendChild(buildReqRow(r, 'incoming')));

        outEmpty.style.display = outgoing.length ? 'none' : 'block';
        outgoing.forEach(r => outEl.appendChild(buildReqRow(r, 'outgoing')));
    } catch (err) {
        console.error(err);
        inEl.innerHTML = `<p class="hint error">${t('讀取邀請失敗')}</p>`;
    }
}

function buildReqRow(item, kind) {
    const row = document.createElement('div');
    row.className = 'friend-req-row';
    const photo = item.other_avatar || '';
    const name = item.other_nickname || '(無名)';
    const av = photo
        ? `<div class="friend-avatar" style="width:48px;height:48px;overflow:hidden;flex-shrink:0;"><img src="${escAttr(photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`
        : `<div class="friend-avatar" style="width:48px;height:48px;background:var(--brown-10);flex-shrink:0;">${escHtml((name || '?')[0].toUpperCase())}</div>`;
    const sub = kind === 'incoming' ? t('向你發出好友邀請') : t('等待對方回覆中…');
    row.innerHTML = `${av}<div style="flex:1;text-align:left;"><p class="friend-name">${escHtml(name)}</p><p class="friend-sub">${sub}</p></div>`;

    if (kind === 'incoming') {
        const btns = document.createElement('div');
        btns.className = 'req-btns';
        const acc = document.createElement('button');
        acc.className = 'req-btn req-accept'; acc.innerText = t('接受');
        acc.onclick = () => acceptFriendRequest(item.id);
        const dec = document.createElement('button');
        dec.className = 'req-btn req-decline'; dec.innerText = t('拒絕');
        dec.onclick = () => declineFriendRequest(item.id);
        btns.appendChild(acc); btns.appendChild(dec);
        row.appendChild(btns);
    } else {
        // outgoing：撤回自己送出的邀請
        const cancel = document.createElement('button');
        cancel.className = 'req-btn req-cancel'; cancel.innerText = t('撤回');
        cancel.onclick = () => withdrawFriendRequest(item.id);
        row.appendChild(cancel);
    }
    return row;
}

// last_seen ISO → 相對時間文案（對齊 front-preview 的「N 小時前在線 / 昨天 / N 天前」）
function relLastSeen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return t('剛剛在線');
    const min = Math.floor(diffMs / 60000);
    if (min < 3) return t('剛剛在線');
    if (min < 60) return t('{n} 分鐘前在線', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('{n} 小時前在線', { n: hr });
    const day = Math.floor(hr / 24);
    if (day === 1) return t('昨天');
    return t('{n} 天前', { n: day });
}

// ── 好友個人資料頁 ──
function openFriendProfile(uid) {
    if (!uid) return;
    stopAfScanner();
    state.friendProfileUid = uid;
    switchView('view-friend-profile');
}

// ── 加好友：模式切換 ──
function showAddMode(mode) {
    stopAfScanner();
    document.getElementById('af-mode-select').style.display = mode === 'select' ? 'flex' : 'none';
    document.getElementById('af-qr-view').style.display = mode === 'qr' ? 'flex' : 'none';
    document.getElementById('af-search-view').style.display = mode === 'search' ? 'flex' : 'none';
    document.getElementById('af-myqr-view').style.display = mode === 'myqr' ? 'flex' : 'none';
    if (mode === 'qr') startAfScanner();
    if (mode === 'myqr') renderMyQr();
    if (mode === 'search') {
        document.getElementById('af-result').style.display = 'none';
        document.getElementById('af-search-msg').innerText = '';
    }
}

// ── QR 掃描 ──
function startAfScanner() {
    const hint = document.getElementById('af-qr-hint');
    if (typeof Html5Qrcode === 'undefined') { hint.innerText = t('掃描函式庫載入失敗，請重新整理頁面'); return; }
    hint.innerText = t('啟動相機中…');
    afScanner = new Html5Qrcode('af-qr-scanner');
    afScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        (decodedText) => { stopAfScanner(); resolveScannedFriend(decodedText); },
        () => {}
    ).then(() => { hint.innerText = t('把 QR Code 對準框內'); })
     .catch((err) => { hint.innerText = t('無法啟動相機：') + (err.message || err); });
}

function stopAfScanner() {
    if (afScanner) {
        try { afScanner.stop().catch(() => {}); } catch (_) {}
        try { afScanner.clear(); } catch (_) {}
        afScanner = null;
    }
}

async function resolveScannedFriend(text) {
    let handle = '';
    try { handle = new URL(text).searchParams.get('add_friend') || ''; } catch (_) {}
    if (!handle) handle = (text || '').trim().replace(/^@/, '');
    if (!handle) { showToast(t('不認得這個 QR Code'), 'error'); showAddMode('select'); return; }
    const profile = await lookupByHandle(handle);
    if (profile) openFriendProfile(profile.uid);
    else { showToast(t('找不到這個 ID 的使用者'), 'error'); showAddMode('select'); }
}

// ── ID 搜尋 ──
async function handleIdSearch() {
    const input = document.getElementById('af-id-input');
    const msg = document.getElementById('af-search-msg');
    const resultEl = document.getElementById('af-result');
    const handle = (input.value || '').trim().toLowerCase().replace(/^@/, '');
    if (!handle) { msg.innerText = t('請輸入 ID'); msg.className = 'hint error'; return; }
    msg.innerText = t('搜尋中…'); msg.className = 'hint'; resultEl.style.display = 'none';
    const profile = await lookupByHandle(handle);
    if (!profile) { msg.innerText = t('找不到這個 ID 的使用者'); msg.className = 'hint error'; return; }
    msg.innerText = '';
    document.getElementById('af-result-name').innerText = profile.nickname || profile.handle || profile.uid;
    document.getElementById('af-result-id').innerText = '@' + (profile.handle || '');
    const avEl = document.getElementById('af-result-avatar');
    if (profile.photoURL) { avEl.innerHTML = `<img src="${escAttr(profile.photoURL)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`; avEl.style.background = 'transparent'; }
    else { avEl.textContent = (profile.nickname || profile.handle || '?')[0].toUpperCase(); }
    document.getElementById('af-result-add').onclick = () => openFriendProfile(profile.uid);
    resultEl.style.display = 'flex';
}

async function lookupByHandle(handle) {
    try {
        const { res, data } = await apiFetch(`/api/users/by_handle/${encodeURIComponent(handle)}`);
        if (res.ok && data?.profile) return data.profile;
    } catch (_) {}
    return null;
}

// ── 我的 QR ──
function renderMyQr() {
    const handle = state.currentProfile?.handle || '';
    const box = document.getElementById('af-myqr-box');
    const handleEl = document.getElementById('af-myqr-handle');
    const noHandle = document.getElementById('af-myqr-nohandle');
    box.innerHTML = '';
    if (!handle) { box.style.display = 'none'; handleEl.style.display = 'none'; noHandle.style.display = 'block'; return; }
    box.style.display = ''; handleEl.style.display = ''; noHandle.style.display = 'none';
    handleEl.innerText = '@' + handle;
    if (typeof QRCode === 'undefined') { box.innerHTML = `<p class="hint">${t('QR 函式庫載入失敗')}</p>`; return; }
    const link = `${window.location.origin}/?add_friend=${encodeURIComponent(handle)}`;
    new QRCode(box, { text: link, width: 168, height: 168, colorDark: '#4f351a', colorLight: '#ffffff' });
}

async function shareMyId() {
    const handle = state.currentProfile?.handle || '';
    if (!handle) { showToast(t('你還沒設定用戶 ID'), 'info'); return; }
    const link = `${window.location.origin}/?add_friend=${encodeURIComponent(handle)}`;
    try { await navigator.clipboard.writeText(link); showToast(t('已複製加好友連結'), 'success'); }
    catch { prompt(t('複製此連結：'), link); }
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }
