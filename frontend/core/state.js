// core/state.js — 跨 module 共享 state singleton
// 取代原本散落在 app.js 的 30+ 個 let 全域變數
import { uuidv4 } from '../utils/uuid.js';

// 訪客 ID — 一旦發過就存 localStorage,登出回到訪客時還是同一個 id
const guestId = localStorage.getItem('phubbing_uid') || uuidv4();
localStorage.setItem('phubbing_uid', guestId);

export const state = {
    // === 連線 ===
    ws: null,
    roomId: null,
    pendingRoomId: null,           // 掃 QR 進來但還沒輸入暱稱

    // === 使用者 ===
    currentUser: null,             // Firebase user 物件
    currentProfile: null,          // /api/me 回傳的 profile
    guestUserId: guestId,
    userId: guestId,               // 登入後切成 firebase uid

    // === 房間/聚會 ===
    amIHost: false,
    roomHostUid: null,
    myNickname: '',
    currentRoomMode: 'GATHERING',
    currentPhase: 'HOME',
    sessionStartTime: null,
    totalDeviations: 0,

    // === Sync Ritual ===
    holdInterval: null,
    myProgress: 0,
    isReady: false,

    // === Buffer (分心倒數) ===
    bufferTimerObj: null,
    bufferSecondsLeft: 30,

    // === 好友 cache ===
    friendUidSet: new Set(),
    outgoingPendingSet: new Set(),
    incomingPendingSet: new Set(),
    memberPreviewUid: null,

    // === 照片 ===
    photoModeActive: false,
    photoModeTimeoutObj: null,
    currentMeetingDetailId: null,
    currentMeetingIsHost: false,
    currentMeetingPhotos: [],
    lightboxPhoto: null,

    // === 題庫 ===
    qbankCurrentTab: 'mine',
    qbankMyQuestions: [],
    qbankPublicQuestions: [],
    qeditContext: { mode: 'new', questionId: null },
    qpickerCurrentTab: 'mine',

    // === 排行榜 ===
    currentLeaderboardTab: 'global',

    // === Taboo Game ===
    taboo: {
        currentWord: null,
        countdownInterval: null,
        flipMode: false,
    },

    // === 其他 ===
    qrScanner: null,
    lastMeetingView: null,
};
