// UUID Generator for Guest User IDs
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ==== Firebase 初始化 ====
const firebaseConfig = {
    apiKey: "AIzaSyBD_Q2H2H7HalmKV2A4TT1I2J9md9Mtq3k",
    authDomain: "graduation-6ae65.firebaseapp.com",
    projectId: "graduation-6ae65",
    storageBucket: "graduation-6ae65.firebasestorage.app",
    messagingSenderId: "798458690617",
    appId: "1:798458690617:web:bda0f994b531be1f4461e8",
    measurementId: "G-8STMGY1K1C"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const storage = firebase.storage();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// API Configuration
// BACKEND_HOST 只留網址主體，不加 https://
const BACKEND_HOST = 'phubbing-backend-798458690617.asia-east1.run.app';

const isSecure = window.location.protocol === 'https:';
const HTTP_PROTOCOL = isSecure ? 'https://' : 'http://';
const WS_PROTOCOL = isSecure ? 'wss://' : 'ws://';

// State
let ws = null;
let roomId = null;
let currentUser = null;       // Firebase user 物件 (登入後)
let currentProfile = null;    // 後端 /api/me 回傳的 profile
// 訪客 ID 預先準備（未登入加入房間時用）
let guestUserId = localStorage.getItem('phubbing_uid') || uuidv4();
localStorage.setItem('phubbing_uid', guestUserId);
// 真正連 ws 用的 userId：登入時為 firebase uid，訪客為 guestUserId
let userId = guestUserId;

let amIHost = false;
let currentPhase = 'HOME'; 
let sessionStartTime = null;
let totalDeviations = 0;
let holdInterval = null;
let myProgress = 0;
let bufferTimerObj = null;
let bufferSecondsLeft = 30;

let currentRoomMode = 'GATHERING'; 
let isReady = false;

// UI Elements
const viewHome = document.getElementById('view-home');
const viewHostRoom = document.getElementById('view-host-room');
const viewSyncRitual = document.getElementById('view-sync-ritual');
const viewFocus = document.getElementById('view-focus');
const viewBuffer = document.getElementById('view-buffer');
const viewSummary = document.getElementById('view-summary');
const viewQaGame = document.getElementById('view-qa-game');
const viewProfile = document.getElementById('view-profile');
const viewJoin = document.getElementById('view-join');
const viewWaitingRoom = document.getElementById('view-waiting-room');
const viewScanner = document.getElementById('view-scanner');
const viewMeetings = document.getElementById('view-meetings');
const viewMeetingDetail = document.getElementById('view-meeting-detail');

// 正在嘗試加入的房間 ID（掃 QR 進來時暫存，還沒真的連 ws）
let pendingRoomId = null;
// 本次連線使用的暱稱
let myNickname = '';
// 房主 uid（房間有更新時從 room_state 收到）
let roomHostUid = null;
// QR 掃描器物件
let qrScanner = null;

// 🟢 擴充：多題目題庫字典
const qaDatabase = {
    "GATHERING": [
        { q: "你的性向是？", opts: ["A. 女異性戀", "B. 男異性戀", "C. 女同性戀", "D. 男同性戀"] },
        { q: "如果現在要一個人去買單，誰看起來最有錢？", opts: ["A. 潘振軒", "B. 吳佩霓", "C. 科穎文", "D. 陳厚名"] }
    ],
    "FAMILY": [
        { q: "這次家庭聚會，等一下誰負責洗碗？", opts: ["A. 爸爸", "B. 媽媽", "C. 我", "D. 妹妹"] },
        { q: "最期待誰的遺產？", opts: ["A. 爸爸", "B. 媽媽", "C. 奶奶", "D. 爺爺"] }
    ],
    "MEETING": [
        { q: "對於剛才討論的內容，你的看法是？", opts: ["A. 非常贊成", "B. 還有待商榷", "C. 部分贊同", "D. 完全不贊同"] }
    ],
    "CLASS": [
        { q: "老師剛才講的概念，你聽懂了嗎？", opts: ["A. 完全懂", "B. 懂一半", "C. 不太懂", "D. 完全不懂"] }
    ]
};

const uiViews = [viewHome, viewHostRoom, viewSyncRitual, viewFocus, viewBuffer, viewSummary, viewQaGame, viewProfile, viewJoin, viewWaitingRoom, viewScanner, viewMeetings, viewMeetingDetail];

function switchView(viewElement) {
    if (!viewElement) return; 
    uiViews.forEach(el => {
        if(el) el.classList.remove('active');
    });
    viewElement.classList.add('active');
}

// 🟢 擴充：背景顏色同步函式
function updateThemeByMode(mode) {
    document.body.classList.remove('mode-gathering', 'mode-family', 'mode-meeting', 'mode-class');
    const modeClassMap = { "GATHERING": "mode-gathering", "FAMILY": "mode-family", "MEETING": "mode-meeting", "CLASS": "mode-class" };
    document.body.classList.add(modeClassMap[mode]);
}

// ==== Firebase Auth Helpers ====
// 取得目前可顯示的暱稱：先用 Firestore profile.nickname，沒有就 fallback 到 Google displayName
function getDisplayNickname() {
    if (currentProfile && currentProfile.nickname) return currentProfile.nickname;
    if (currentUser && currentUser.displayName) return currentUser.displayName;
    return '';
}

async function getAuthHeaders() {
    if (!currentUser) return { 'Content-Type': 'application/json' };
    const idToken = await currentUser.getIdToken(/* forceRefresh */ false);
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
    };
}

function renderAuthBar() {
    const loggedOut = document.getElementById('auth-logged-out');
    const loggedIn = document.getElementById('auth-logged-in');
    const homeHint = document.getElementById('home-login-hint');
    const meetingsBtn = document.getElementById('btn-open-meetings');

    if (currentUser && currentProfile) {
        loggedOut.style.display = 'none';
        loggedIn.style.display = 'flex';
        const avatarEl = document.getElementById('auth-avatar');
        const nickEl = document.getElementById('auth-nickname');
        avatarEl.src = currentProfile.photoURL || currentUser.photoURL || '';
        nickEl.innerText = currentProfile.nickname || currentUser.displayName || '使用者';
        if (homeHint) homeHint.style.display = 'none';
        if (meetingsBtn) meetingsBtn.style.display = 'block';
    } else {
        loggedOut.style.display = 'block';
        loggedIn.style.display = 'none';
        if (homeHint) homeHint.style.display = 'block';
        if (meetingsBtn) meetingsBtn.style.display = 'none';
    }
}

async function fetchMyProfile() {
    if (!currentUser) { currentProfile = null; return; }
    try {
        const res = await fetch(`${HTTP_PROTOCOL}${BACKEND_HOST}/api/me`, {
            headers: await getAuthHeaders()
        });
        const data = await res.json();
        if (data.status === 'success') {
            currentProfile = data.profile;
        } else {
            console.warn('fetchMyProfile failed:', data);
            currentProfile = null;
        }
    } catch (err) {
        console.error('fetchMyProfile error:', err);
        currentProfile = null;
    }
}

// 監聽 auth 狀態變化（page reload 後也會自動觸發）
auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    if (user) {
        userId = user.uid;                     // 登入後使用 firebase uid
        await fetchMyProfile();
    } else {
        userId = guestUserId;                  // 登出後退回訪客 id
        currentProfile = null;
    }
    renderAuthBar();

    // 如果使用者現在在「加入聚會」畫面且暱稱欄位是空的，就補上目前可用的暱稱
    if (viewJoin && viewJoin.classList.contains('active')) {
        const joinInput = document.getElementById('join-nickname');
        const hintEl = document.getElementById('join-login-hint');
        const nick = getDisplayNickname();
        if (joinInput && !joinInput.value && nick) {
            joinInput.value = nick;
            if (hintEl) hintEl.style.display = 'none';
        }
    }
});

async function doGoogleLogin() {
    try {
        await auth.signInWithPopup(googleProvider);
        // onAuthStateChanged 會接手後續更新
    } catch (err) {
        console.error('Google sign-in failed:', err);
        alert('Google 登入失敗：' + (err.message || err));
    }
}

async function doLogout() {
    // 如果目前還在聚會中，要先提醒使用者
    const inSessionView = viewHostRoom.classList.contains('active') ||
                          viewWaitingRoom.classList.contains('active') ||
                          viewSyncRitual.classList.contains('active') ||
                          viewFocus.classList.contains('active') ||
                          viewQaGame.classList.contains('active') ||
                          viewBuffer.classList.contains('active');

    if (inSessionView || roomId) {
        const msg = amIHost
            ? '登出將會取消這次聚會並通知所有成員，確定要登出嗎？'
            : '登出將會離開目前的聚會並返回首頁，確定要登出嗎？';
        if (!confirm(msg)) return;

        // 房主登出 → 先廣播 END_SESSION 給所有成員
        if (amIHost && ws && ws.readyState === WebSocket.OPEN) {
            try {
                const mins = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 60000) : 0;
                ws.send(JSON.stringify({
                    action: "END_SESSION",
                    reason: "host_left",
                    duration_minutes: mins
                }));
                // 等一小段時間讓後端真的把訊息廣播出去，再關 ws
                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                console.warn('END_SESSION broadcast failed:', err);
            }
        }

        cleanupSession();
        switchView(viewHome);
    }

    try {
        await auth.signOut();
        // onAuthStateChanged 會把 UI 切回未登入
    } catch (err) {
        console.error('Sign-out failed:', err);
    }
}

// ==== Profile 頁面邏輯 ====
function openProfileView() {
    if (!currentUser) {
        alert('請先登入 Google 帳號');
        return;
    }
    document.getElementById('profile-avatar-preview').src =
        (currentProfile && currentProfile.photoURL) || currentUser.photoURL || '';
    document.getElementById('profile-nickname').value =
        (currentProfile && currentProfile.nickname) || currentUser.displayName || '';
    document.getElementById('profile-bio').value =
        (currentProfile && currentProfile.bio) || '';
    document.getElementById('profile-status').innerText = '';
    switchView(viewProfile);
}

async function uploadAvatar(file) {
    if (!currentUser) throw new Error('未登入');
    const ref = storage.ref().child(`avatars/${currentUser.uid}/${Date.now()}_${file.name}`);
    const snap = await ref.put(file);
    return await snap.ref.getDownloadURL();
}

async function saveProfile() {
    if (!currentUser) return;
    const statusEl = document.getElementById('profile-status');
    statusEl.style.color = '#34d399';
    statusEl.innerText = '儲存中...';

    const payload = {
        nickname: document.getElementById('profile-nickname').value.trim(),
        bio: document.getElementById('profile-bio').value.trim()
    };

    // 若使用者選了新頭像，先傳 Storage
    const fileInput = document.getElementById('profile-avatar-input');
    const file = fileInput.files && fileInput.files[0];
    try {
        if (file) {
            statusEl.innerText = '上傳頭像中...';
            payload.photoURL = await uploadAvatar(file);
        }

        const res = await fetch(`${HTTP_PROTOCOL}${BACKEND_HOST}/api/profile`, {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'success') {
            currentProfile = data.profile;
            renderAuthBar();
            statusEl.innerText = '已儲存 ✔';
            fileInput.value = '';
        } else {
            statusEl.style.color = '#f87171';
            statusEl.innerText = '儲存失敗：' + (data.detail || JSON.stringify(data));
        }
    } catch (err) {
        statusEl.style.color = '#f87171';
        statusEl.innerText = '儲存失敗：' + (err.message || err);
    }
}

// ==== INIT / SETUP ====
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');

    if (roomFromUrl) {
        // 掃 QR Code 進來：先顯示「加入聚會」畫面，請使用者輸入暱稱
        pendingRoomId = roomFromUrl;
        showJoinView();
    } else {
        switchView(viewHome);
    }

    lottie.loadAnimation({
        container: document.getElementById('lottie-orb'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'https://lottie.host/9e4d6a66-515c-48be-85cf-5b43deabeb2b/F9PzUfV6u8.json'
    });

    // ===== Auth bar 按鈕 =====
    document.getElementById('btn-google-login').onclick = doGoogleLogin;
    document.getElementById('btn-logout').onclick = doLogout;
    document.getElementById('btn-open-profile').onclick = openProfileView;

    // ===== Profile 頁按鈕 =====
    document.getElementById('btn-profile-save').onclick = saveProfile;
    document.getElementById('btn-profile-back').onclick = () => switchView(viewHome);

    // 即時預覽頭像
    document.getElementById('profile-avatar-input').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) {
            const url = URL.createObjectURL(f);
            document.getElementById('profile-avatar-preview').src = url;
        }
    });

    // ===== 加入聚會 / 等待房 按鈕 =====
    document.getElementById('btn-confirm-join').onclick = confirmJoinRoom;
    document.getElementById('btn-cancel-join').onclick = () => {
        pendingRoomId = null;
        // 把網址的 ?room=xxx 清掉
        history.replaceState(null, '', window.location.pathname);
        switchView(viewHome);
    };
    document.getElementById('btn-leave-waiting').onclick = () => {
        if (confirm('確定要離開聚會嗎？')) {
            cleanupSession();
            switchView(viewHome);
        }
    };

    // ===== 首頁的 QR Code 掃描按鈕 =====
    document.getElementById('btn-scan-qr').onclick = startQrScanner;
    document.getElementById('btn-scanner-cancel').onclick = () => {
        stopQrScanner();
        switchView(viewHome);
    };

    // ===== 聚會紀錄按鈕 =====
    document.getElementById('btn-open-meetings').onclick = openMeetingsList;
    document.getElementById('btn-meetings-back').onclick = () => switchView(viewHome);
    document.getElementById('btn-meeting-detail-back').onclick = openMeetingsList;

    // ===== 房主的「開始同步定錨」改成廣播 START_SYNC =====
    const startSyncBtn = document.getElementById('btn-start-sync');
    if (startSyncBtn) {
        startSyncBtn.onclick = () => {
            if (startSyncBtn.classList.contains('disabled')) return;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: "START_SYNC" }));
            }
        };
    }
};

// ==== 加入聚會流程 ====
function showJoinView() {
    const input = document.getElementById('join-nickname');
    const hint = document.getElementById('join-login-hint');
    // 預填：用 getDisplayNickname()（profile.nickname → displayName fallback）
    const nick = getDisplayNickname();
    if (nick) {
        input.value = nick;
        hint.style.display = 'none';
    } else {
        input.value = '';
        hint.style.display = 'block';
    }
    switchView(viewJoin);
    setTimeout(() => input.focus(), 100);
}

function confirmJoinRoom() {
    const input = document.getElementById('join-nickname');
    const name = (input.value || '').trim();
    if (!name) {
        alert('請先輸入暱稱才能加入聚會');
        input.focus();
        return;
    }
    myNickname = name.slice(0, 20);
    const rid = pendingRoomId;
    pendingRoomId = null;
    amIHost = false;
    joinRoom(rid);
}

function cleanupSession() {
    if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
    }
    roomId = null;
    amIHost = false;
    currentPhase = 'HOME';
    roomHostUid = null;
    myNickname = '';
    document.body.className = '';
    // 把網址 ?room=xxx 清掉
    history.replaceState(null, '', window.location.pathname);
}

// ==== QR Code 掃描器 ====
function startQrScanner() {
    switchView(viewScanner);
    const hint = document.getElementById('scanner-hint');
    if (typeof Html5Qrcode === 'undefined') {
        if (hint) hint.innerText = '掃描函式庫載入失敗，請重新整理頁面';
        return;
    }
    if (hint) hint.innerText = '啟動相機中...';

    qrScanner = new Html5Qrcode("scanner-container");
    qrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
            // 掃到內容：嘗試從 URL 取 ?room=xxx，或直接視為 room id
            console.log('[QR] decoded:', decodedText);
            let rid = null;
            try {
                const u = new URL(decodedText);
                rid = new URLSearchParams(u.search).get('room');
            } catch (_) {
                if (/^[a-z0-9]{4,16}$/i.test(decodedText.trim())) {
                    rid = decodedText.trim();
                }
            }
            if (!rid) {
                if (hint) hint.innerText = '不認得這個 QR Code，再試一次...';
                return;
            }
            stopQrScanner();
            pendingRoomId = rid;
            showJoinView();
        },
        (errMsg) => { /* 每幀的偵測失敗訊息，忽略 */ }
    ).then(() => {
        if (hint) hint.innerText = '把 QR Code 對準框內';
    }).catch((err) => {
        console.error('QR scanner failed:', err);
        if (hint) hint.innerText = '無法啟動相機：' + (err.message || err);
    });
}

function stopQrScanner() {
    if (qrScanner) {
        try { qrScanner.stop().catch(() => {}); } catch (e) {}
        try { qrScanner.clear(); } catch (e) {}
        qrScanner = null;
    }
}

// ==== 聚會紀錄 ====
async function openMeetingsList() {
    if (!currentUser) {
        alert('請先登入才能查看聚會紀錄');
        return;
    }
    switchView(viewMeetings);
    const listEl = document.getElementById('meetings-list');
    const emptyEl = document.getElementById('meetings-empty');
    listEl.innerHTML = '<p class="hint">讀取中...</p>';
    emptyEl.style.display = 'none';

    try {
        const res = await fetch(`${HTTP_PROTOCOL}${BACKEND_HOST}/api/meetings`, {
            headers: await getAuthHeaders()
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.detail || '讀取失敗');

        listEl.innerHTML = '';
        if (!data.meetings || data.meetings.length === 0) {
            emptyEl.style.display = 'block';
            return;
        }
        data.meetings.forEach(m => {
            const card = document.createElement('div');
            card.className = 'meeting-card';
            const modeLabel = formatModeLabel(m.mode);
            const dateLabel = formatDateTime(m.ended_at);
            card.innerHTML = `
                <div class="mc-mode">${modeLabel}</div>
                <div class="mc-meta">
                    <span>👥 ${m.member_count || 0} 人</span>
                    <span>⏱ ${m.duration_minutes || 0} 分鐘</span>
                    <span>📅 ${dateLabel}</span>
                </div>`;
            card.onclick = () => openMeetingDetail(m.id);
            listEl.appendChild(card);
        });
    } catch (err) {
        console.error('openMeetingsList failed:', err);
        listEl.innerHTML = `<p class="hint" style="color:#fca5a5;">讀取失敗：${err.message || err}</p>`;
    }
}

async function openMeetingDetail(meetingId) {
    switchView(viewMeetingDetail);
    document.getElementById('md-host').innerText = '讀取中...';
    document.getElementById('md-mode').innerText = '-';
    document.getElementById('md-duration').innerText = '-';
    document.getElementById('md-deviations').innerText = '-';
    document.getElementById('md-time').innerText = '-';
    document.getElementById('md-reason').innerText = '-';
    document.getElementById('md-count').innerText = '0';
    document.getElementById('md-members').innerHTML = '';

    try {
        const res = await fetch(`${HTTP_PROTOCOL}${BACKEND_HOST}/api/meetings/${meetingId}`, {
            headers: await getAuthHeaders()
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.detail || '讀取失敗');
        const m = data.meeting;

        document.getElementById('md-host').innerText = m.host_nickname || '(未知)';
        document.getElementById('md-mode').innerText = formatModeLabel(m.mode);
        document.getElementById('md-duration').innerText = m.duration_minutes || 0;
        document.getElementById('md-deviations').innerText = m.total_deviations || 0;
        document.getElementById('md-time').innerText = formatDateTime(m.ended_at);
        document.getElementById('md-reason').innerText = formatEndReason(m.end_reason);

        const members = m.members_snapshot || [];
        document.getElementById('md-count').innerText = members.length;
        const ul = document.getElementById('md-members');
        ul.innerHTML = '';
        members.forEach(mem => {
            const li = document.createElement('li');
            const name = document.createElement('span');
            name.innerText = mem.nickname || '(無名)';
            li.appendChild(name);
            if (mem.uid === m.host_uid) {
                const tag = document.createElement('span');
                tag.className = 'member-tag host';
                tag.innerText = '(房主)';
                li.appendChild(tag);
            } else if (mem.is_guest) {
                const tag = document.createElement('span');
                tag.className = 'member-tag';
                tag.style.color = 'var(--text-secondary)';
                tag.innerText = '(訪客)';
                li.appendChild(tag);
            }
            ul.appendChild(li);
        });
    } catch (err) {
        console.error('openMeetingDetail failed:', err);
        document.getElementById('md-host').innerText = '讀取失敗：' + (err.message || err);
    }
}

function formatModeLabel(mode) {
    return ({
        "GATHERING": "🎉 朋友聚會",
        "FAMILY": "🏠 家庭聚會",
        "MEETING": "💼 嚴肅開會",
        "CLASS": "📚 上課模式",
        "QA_GAME": "❓ 團體問答",
        "ACTIVE": "🎉 朋友聚會"
    })[mode] || (mode || '聚會');
}

function formatEndReason(r) {
    return ({
        "host_ended": "房主結束聚會",
        "host_left": "房主離開了聚會"
    })[r] || (r || '正常結束');
}

function formatDateTime(iso) {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        if (isNaN(d)) return iso;
        return d.toLocaleString('zh-TW', { hour12: false });
    } catch (_) {
        return iso;
    }
}

document.getElementById('btn-create-room').onclick = async () => {
    // 發起聚會強制要求登入
    if (!currentUser) {
        alert('請先用 Google 登入才能發起聚會');
        return;
    }

    amIHost = true;
    // 房主的暱稱：優先 Firestore profile.nickname → Google displayName → fallback "房主"
    myNickname = getDisplayNickname() || '房主';

    const frontendUrl = window.location.protocol + "//" + window.location.host;
    try {
        const res = await fetch(
            `${HTTP_PROTOCOL}${BACKEND_HOST}/api/create_room?frontend_url=${encodeURIComponent(frontendUrl)}`,
            {
                mode: 'cors',
                headers: await getAuthHeaders()
            }
        );

        if (res.status === 401) {
            alert('登入狀態失效，請重新登入');
            await doLogout();
            return;
        }

        const data = await res.json();
        document.getElementById('qr-code-img').src = 'data:image/png;base64,' + data.qr_base64;
        joinRoom(data.room_id);
    } catch (err) {
        console.error('create_room failed:', err);
        alert('建立房間失敗：' + (err.message || err));
        amIHost = false;
    }
};

// ==== 模式切換與視覺回饋邏輯 ====
function setActiveModeBtn(clickedBtnId) {
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active-mode'));
    if (clickedBtnId) {
        const activeBtn = document.getElementById(clickedBtnId);
        if (activeBtn) activeBtn.classList.add('active-mode');
    }
}

document.addEventListener('click', function(e) {
    // btn-start-sync 已在 window.onload 綁定 onclick（會發 START_SYNC 給後端），這裡不再處理

    const modeBtn = e.target.closest('.mode-btn');
    if (modeBtn) {
        const btnId = modeBtn.id;
        setActiveModeBtn(btnId); 
        
        if (btnId === 'btn-mode-gathering') currentRoomMode = "GATHERING";
        else if (btnId === 'btn-mode-family') currentRoomMode = "FAMILY";
        else if (btnId === 'btn-mode-meeting') currentRoomMode = "MEETING";
        else if (btnId === 'btn-mode-class') currentRoomMode = "CLASS";
        
        updateThemeByMode(currentRoomMode); // 房主端先行變色回饋

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({action: "CHANGE_MODE", mode: currentRoomMode}));
        }
    }
    
    // 🟢 擴充：房主發起問答 (從多題庫隨機出一題)
    const qaBtn = e.target.closest('#btn-mode-qa');
    if (qaBtn) {
        const questions = qaDatabase[currentRoomMode];
        const randomItem = questions[Math.floor(Math.random() * questions.length)];
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: "START_QA", 
                question: randomItem.q,
                options: randomItem.opts
            }));
        }
    }
});

// ==== WEBSOCKET ====
function joinRoom(id) {
    roomId = id;
    const nickParam = encodeURIComponent(myNickname || '訪客');
    const wsUrl = `${WS_PROTOCOL}${BACKEND_HOST}/ws/${roomId}/${userId}?nickname=${nickParam}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        if (amIHost) {
            switchView(viewHostRoom);
        } else {
            // 訪客加入後進「等待房主開始」畫面
            currentPhase = 'WAITING';
            switchView(viewWaitingRoom);
        }
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log('[WS RECV]', msg);  // DEBUG: log all messages
        handleServerMessage(msg);
    };

    ws.onerror = (err) => console.error('[WS ERROR]', err);
    ws.onclose = (e) => console.warn('[WS CLOSED]', e.code, e.reason);
}

// 把成員字典渲染成 <li> 清單（同時用在 host-room 與 waiting-room）
// 顯示格式："小明 (房主)" 或 "小明 (你)"，房主與你皆是時優先顯示「房主」
function renderMemberList(members) {
    const entries = Object.entries(members || {});
    const renderTo = (ulEl, countEl) => {
        if (!ulEl) return;
        ulEl.innerHTML = '';
        entries.forEach(([uid, info]) => {
            const li = document.createElement('li');
            const nameSpan = document.createElement('span');
            nameSpan.innerText = (info && info.nickname) ? info.nickname : '(無名)';
            li.appendChild(nameSpan);

            const isHost = roomHostUid && uid === roomHostUid;
            const isMe = uid === userId;

            if (isHost) {
                const tag = document.createElement('span');
                tag.className = 'member-tag host';
                tag.innerText = isMe ? '(房主・你)' : '(房主)';
                li.appendChild(tag);
            } else if (isMe) {
                const tag = document.createElement('span');
                tag.className = 'member-tag you';
                tag.innerText = '(你)';
                li.appendChild(tag);
            }
            ulEl.appendChild(li);
        });
        if (countEl) countEl.innerText = entries.length;
    };

    renderTo(document.getElementById('member-list-ul'),
             document.getElementById('member-count'));
    renderTo(document.getElementById('waiting-member-list-ul'),
             document.getElementById('waiting-member-count'));
}

function handleServerMessage(msg) {
    if (msg.type === "ROOM_UPDATE") {
        const state = msg.room_state || {};
        if (state.host_uid) roomHostUid = state.host_uid;
        renderMemberList(state.members || {});
        if (amIHost) {
            document.getElementById('btn-start-sync').classList.remove('disabled');
        }
    } else if (msg.type === "SYNC_STARTED") {
        // 所有人（含房主）一起進入 HOLD 介面
        currentPhase = 'SYNC';
        isReady = false;
        myProgress = 0;
        const progressFill = document.getElementById('sync-progress-fill');
        if (progressFill) {
            progressFill.style.width = '0%';
            progressFill.style.background = "linear-gradient(90deg, #3b82f6, #10b981)";
        }
        const btnHold = document.getElementById('btn-sync-hold');
        if (btnHold) {
            btnHold.innerText = "HOLD";
            btnHold.style.background = "";
        }
        switchView(viewSyncRitual);
    } else if (msg.type === "SESSION_ENDED") {
        // 房主結束聚會 / 房主離開 → 全員跳結算頁
        const reason = msg.reason || 'host_ended';
        const mins = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 60000) : 0;
        document.getElementById('summary-time').innerText = mins;
        document.getElementById('summary-deviations').innerText = totalDeviations;

        // 顯示提示文字（依原因）
        const summaryView = document.getElementById('view-summary');
        let hint = document.getElementById('summary-host-hint');
        if (!hint && summaryView) {
            hint = document.createElement('p');
            hint.id = 'summary-host-hint';
            // 插在 h2 後面
            const h2 = summaryView.querySelector('h2');
            if (h2 && h2.nextSibling) {
                summaryView.insertBefore(hint, h2.nextSibling);
            } else {
                summaryView.appendChild(hint);
            }
        }
        if (hint) {
            if (reason === 'host_left') {
                hint.innerText = '⚠️ 房主已離開此聚會';
            } else if (!amIHost) {
                hint.innerText = '房主已結束聚會';
            } else {
                hint.innerText = '';
            }
        }

        currentPhase = 'SUMMARY';
        document.body.className = '';
        // 清掉殘留的 buffer 倒數計時
        if (bufferTimerObj) { clearInterval(bufferTimerObj); bufferTimerObj = null; }
        if (ws) {
            try { ws.close(); } catch (e) {}
            ws = null;
        }
        switchView(viewSummary);
    } else if (msg.type === "ANCHOR_ESTABLISHED") {
        currentPhase = 'ACTIVE';
        sessionStartTime = Date.now();
        switchView(viewFocus);
        document.body.classList.add('mode-flow');

        if (amIHost) {
            document.getElementById('host-only-controls').style.display = 'block';
        }
    } else if (msg.type === "DEVIATION_RECORDED") {
        totalDeviations = msg.total_deviations;
        document.getElementById('deviation-count').innerText = totalDeviations;
    } else if (msg.type === "MODE_CHANGED") {
        currentRoomMode = msg.mode;
        updateThemeByMode(msg.mode); // 🟢 擴充：同步所有人背景顏色
    } else if (msg.type === "QA_STARTED") {
        currentPhase = 'QA_GAME'; 
        switchView(viewQaGame);
        
        const questionEl = document.getElementById('qa-question-text');
        const container = document.getElementById('qa-options-container');
        const statusEl = document.getElementById('qa-status');
        
        if (questionEl) questionEl.innerText = msg.question;
        if (statusEl) statusEl.innerText = "";
        
        if (container) {
            container.innerHTML = ''; 
            msg.options.forEach(opt => {
                let btn = document.createElement('button');
                btn.innerText = opt;
                btn.className = 'qa-option-btn'; 
                btn.onclick = () => {
                    ws.send(JSON.stringify({action: "SUBMIT_ANSWER", answer: opt}));
                    if (statusEl) statusEl.innerText = "你已送出答案，等待其他人...";
                    Array.from(container.children).forEach(b => b.disabled = true);
                };
                container.appendChild(btn);
            });
        }
    } else if (msg.type === "QA_PROGRESS") {
        // 即時更新「X/Y 已作答」進度（已送答的人才會看到）
        const statusEl = document.getElementById('qa-status');
        if (statusEl && statusEl.innerText.includes("等待其他人")) {
            statusEl.innerText = `你已送出答案，等待其他人... (${msg.answered_count}/${msg.total_count})`;
        }
    } else if (msg.type === "QA_FINISHED") {
        // 全員答完，顯示票數結果，5 秒後自動回到定錨畫面
        const statusEl = document.getElementById('qa-status');
        const container = document.getElementById('qa-options-container');
        const questionEl = document.getElementById('qa-question-text');

        // 把選項按鈕區改成結果統計
        if (container) {
            container.innerHTML = '';
            // 按票數排序顯示
            const sorted = Object.entries(msg.results).sort((a, b) => b[1] - a[1]);
            sorted.forEach(([opt, count]) => {
                const div = document.createElement('div');
                div.className = 'qa-option-btn';
                div.style.opacity = '1';
                div.style.cursor = 'default';
                div.innerText = `${opt}  —  ${count} 票`;
                container.appendChild(div);
            });
        }

        if (questionEl) questionEl.innerText = "📊 結果統計";
        if (statusEl) statusEl.innerText = "5 秒後返回定錨...";

        let countdown = 5;
        const countdownInterval = setInterval(() => {
            countdown--;
            if (statusEl) statusEl.innerText = `${countdown} 秒後返回定錨...`;
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                // 回到定錨畫面
                currentPhase = 'ACTIVE';
                switchView(viewFocus);
                document.body.classList.add('mode-flow');
                if (statusEl) statusEl.innerText = "";
            }
        }, 1000);
    }
}

// ==== SYNC RITUAL LOGIC ====
const btnHold = document.getElementById('btn-sync-hold');
const progressFill = document.getElementById('sync-progress-fill');

btnHold.addEventListener('touchstart', startHold, {passive: false});
btnHold.addEventListener('mousedown', startHold);
btnHold.addEventListener('touchend', endHold);
btnHold.addEventListener('mouseup', endHold);
btnHold.addEventListener('mouseleave', endHold);

function startHold(e) {
    if (e.type === 'touchstart') e.preventDefault();
    if(currentPhase !== 'SYNC' || isReady) return; 
    
    holdInterval = setInterval(() => {
        myProgress += 2; 
        if (myProgress >= 100) {
            myProgress = 100;
            isReady = true; 
            progressFill.style.background = "linear-gradient(90deg, #10b981, #34d399)"; 
            btnHold.innerText = "READY"; 
            btnHold.style.background = "#10b981"; 
            clearInterval(holdInterval);
        }
        
        progressFill.style.width = myProgress + '%';
        
        if(ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({action: "SYNC_PROGRESS", progress: myProgress}));
        }
    }, 50);
}

function endHold(e) {
    if(currentPhase !== 'SYNC' || isReady) return; 
    
    clearInterval(holdInterval);
    myProgress = 0;
    progressFill.style.width = '0%';
    if(ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({action: "SYNC_PROGRESS", progress: 0}));
    }
}

// ==== PAGE VISIBILITY API ====
document.addEventListener("visibilitychange", () => {
    if (currentPhase !== 'ACTIVE') return; 

    if (document.visibilityState === "visible") {
        startCognitiveBuffer();
        if(ws) ws.send(JSON.stringify({action: "VISIBILITY_CHANGE", state: "visible"}));
    } else {
        endCognitiveBuffer(true); 
        if(ws) ws.send(JSON.stringify({action: "VISIBILITY_CHANGE", state: "hidden"}));
    }
});

function startCognitiveBuffer() {
    switchView(viewBuffer);
    document.body.classList.remove('mode-flow');
    document.body.classList.add('mode-danger');
    
    bufferSecondsLeft = 30;
    document.getElementById('buffer-timer').innerText = bufferSecondsLeft;
    
    if (navigator.vibrate) navigator.vibrate(200);

    bufferTimerObj = setInterval(() => {
        bufferSecondsLeft--;
        document.getElementById('buffer-timer').innerText = bufferSecondsLeft;
        
        if (bufferSecondsLeft <= 0) {
            clearInterval(bufferTimerObj);
            handleBufferTimeout();
        }
    }, 1000);
}

function endCognitiveBuffer(safe) {
    clearInterval(bufferTimerObj);
    if(safe) {
        switchView(viewFocus);
        document.body.classList.remove('mode-danger');
        document.body.classList.add('mode-flow');
    }
}

function handleBufferTimeout() {
    if(ws) ws.send(JSON.stringify({action: "LOG_DEVIATION"}));
    document.getElementById('lottie-orb').style.filter = "grayscale(100%) opacity(0.5)";
    switchView(viewFocus); 
    document.body.classList.remove('mode-danger');
    
    setTimeout(() => {
        document.getElementById('lottie-orb').style.filter = "none";
        document.body.classList.add('mode-flow');
    }, 5000);
}

// ==== SUMMARY ====
document.getElementById('btn-end-session').onclick = () => {
    if (amIHost && ws && ws.readyState === WebSocket.OPEN) {
        // 房主結束聚會 → 通知所有人（含自己）。SESSION_ENDED handler 會切到結算頁
        const mins = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 60000) : 0;
        ws.send(JSON.stringify({
            action: "END_SESSION",
            reason: "host_ended",
            duration_minutes: mins
        }));
        return;
    }

    // Fallback：若 ws 已斷或不是房主（理論上 btn-end-session 主要給房主用）
    currentPhase = 'SUMMARY';
    document.body.className = '';
    const timeMs = sessionStartTime ? Date.now() - sessionStartTime : 0;
    document.getElementById('summary-time').innerText = Math.round(timeMs / 60000);
    document.getElementById('summary-deviations').innerText = totalDeviations;
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    switchView(viewSummary);
};