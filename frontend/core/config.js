// core/config.js — 全域常數
export const BACKEND_HOST = 'phubbing-backend-798458690617.asia-east1.run.app';

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

// 11 種聚會情境設定 (與後端 CONTEXT_DEFAULTS 對應)
export const CONTEXT_CONFIGS = {
    general:     { label: '一般聚會', icon: '🎉', difficulty: 'L', duration: 90,  mode: 'GATHERING' },
    meeting:     { label: '嚴肅開會', icon: '💼', difficulty: 'H', duration: 60,  mode: 'MEETING'   },
    family:      { label: '家庭聚會', icon: '🏠', difficulty: 'L', duration: 120, mode: 'FAMILY'    },
    study:       { label: '自習讀書', icon: '📖', difficulty: 'M', duration: 90,  mode: 'CLASS'     },
    class:       { label: '正式上課', icon: '📚', difficulty: 'H', duration: 50,  mode: 'CLASS'     },
    meal:        { label: '吃飯聚餐', icon: '🍽️', difficulty: 'L', duration: 90,  mode: 'GATHERING' },
    date:        { label: '約會',     icon: '💑', difficulty: 'M', duration: 120, mode: 'GATHERING' },
    celebration: { label: '慶祝活動', icon: '🥳', difficulty: 'L', duration: 120, mode: 'GATHERING' },
    workshop:    { label: '工作坊',   icon: '🔧', difficulty: 'M', duration: 180, mode: 'MEETING'   },
    team:        { label: '團隊聚會', icon: '👥', difficulty: 'M', duration: 120, mode: 'GATHERING' },
    custom:      { label: '自訂',     icon: '⚙️', difficulty: 'M', duration: 90,  mode: 'GATHERING' },
};

export const DIFFICULTY_LABELS = { L: '輕鬆', M: '標準', H: '嚴格' };

export const PET_BODY_OPTIONS = ['🐰', '🐻', '🐱', '🐶', '🦊', '🐸', '🐧', '🐼', '🐨', '🐯'];
