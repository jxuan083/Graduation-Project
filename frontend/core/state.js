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
    totalDeviations: 0,        // 整個房間的分心總次數
    myDeviations: 0,           // 我自己的分心次數

    // === 聚會設定 (meeting-setup) ===
    currentContext: 'general',
    currentDifficulty: 'L',
    currentExpectedDuration: 90,
    currentGroupId: null,           // 選擇的群組 ID（可選）
    pendingMeetingSetup: null,      // { context, difficulty, expected_duration_min, group_id }

    // === 群組 ===
    myGroups: [],
    currentGroupDetail: null,       // 正在查看的群組 detail
    pendingGroupInviteCode: null,   // URL ?group_invite=CODE 暫存
    petSwapTarget: null,            // { uid, nickname } 要生成寵物臉的成員

    // === Sync Ritual ===
    holdInterval: null,
    myProgress: 0,
    isReady: false,

    // === Buffer (分心倒數) ===
    bufferTimerObj: null,
    bufferSecondsLeft: 30,
    hiddenTimerObj: null,   // 離開分頁計時，超時送 LOG_DEVIATION
    hiddenAt: null,         // 離開時的時間戳，回來時算差值
    pendingDeviation: 0,    // WS 斷線時暫存的分心次數，重連後補送

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
    currentMeetingMembers: [],
    currentMeetingNewspaper: null,
    currentMeetingPhotos: [],
    lightboxPhoto: null,

    // === 即時語音轉文字 ===
    liveTranscript: {
        active: false,
        mediaRecorder: null,
        stream: null,
        speechRecognition: null,
        speechPreviewActive: false,
        chunkTimer: null,
        currentChunks: [],
        mimeType: '',
        queue: [],
        processing: false,
        startedAtMs: 0,
        nextOffsetMs: 0,
        chunkMs: 8000,
        segments: [],
    },

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
