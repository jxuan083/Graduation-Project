// core/config.js — 全域常數
const isLocalFrontend = ['localhost', '127.0.0.1'].includes(window.location.hostname);
export const BACKEND_HOST = isLocalFrontend
    ? '127.0.0.1:8080'
    : 'phubbing-backend-798458690617.asia-east1.run.app';

export const isSecure = window.location.protocol === 'https:';
export const HTTP_PROTOCOL = isSecure ? 'https://' : 'http://';
export const WS_PROTOCOL = isSecure ? 'wss://' : 'ws://';

export const firebaseConfig = {
    apiKey: "AIzaSyBD_Q2H2H7HalmKV2A4TT1I2J9md9Mtq3k",
    authDomain: "graduation-6ae65.firebaseapp.com",
    projectId: "graduation-6ae65",
    storageBucket: "graduation-6ae65.firebasestorage.app",
    messagingSenderId: "798458690617",
    appId: "1:798458690617:web:bda0f994b531be1f4461e8",
    measurementId: "G-8STMGY1K1C"
};

// FCM Web Push 用的 VAPID public key。
// 去 Firebase Console → 專案設定 → Cloud Messaging → Web Push 憑證 → 產生金鑰組，貼在這裡。
// 沒填之前 getToken() 會直接失敗（push.js 有擋，不會炸整個 app）。
export const FCM_VAPID_KEY = "";

// 11 種聚會情境設定 (與後端 CONTEXT_DEFAULTS 對應)
export const CONTEXT_CONFIGS = {
    general:     { label: '一般聚會', icon: 'party-popper',   difficulty: 'L', duration: 90,  mode: 'GATHERING' },
    meeting:     { label: '嚴肅開會', icon: 'briefcase',      difficulty: 'H', duration: 60,  mode: 'MEETING'   },
    family:      { label: '家庭聚會', icon: 'house',          difficulty: 'L', duration: 120, mode: 'FAMILY'    },
    study:       { label: '自習讀書', icon: 'book-open',      difficulty: 'M', duration: 90,  mode: 'CLASS'     },
    class:       { label: '正式上課', icon: 'graduation-cap', difficulty: 'H', duration: 50,  mode: 'CLASS'     },
    meal:        { label: '吃飯聚餐', icon: 'utensils',       difficulty: 'L', duration: 90,  mode: 'GATHERING' },
    date:        { label: '約會',     icon: 'heart',          difficulty: 'M', duration: 120, mode: 'GATHERING' },
    celebration: { label: '慶祝活動', icon: 'party-popper',   difficulty: 'L', duration: 120, mode: 'GATHERING' },
    workshop:    { label: '工作坊',   icon: 'wrench',         difficulty: 'M', duration: 180, mode: 'MEETING'   },
    team:        { label: '團隊聚會', icon: 'users',          difficulty: 'M', duration: 120, mode: 'GATHERING' },
    custom:      { label: '自訂',     icon: 'settings',       difficulty: 'M', duration: 90,  mode: 'GATHERING' },
};

export const DIFFICULTY_LABELS = { L: '輕鬆', M: '標準', H: '嚴格' };

export const PET_BODY_OPTIONS = ['🐰', '🐻', '🐱', '🐶', '🦊', '🐸', '🐧', '🐼', '🐨', '🐯'];
