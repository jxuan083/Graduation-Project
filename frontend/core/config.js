// core/config.js — 全域常數

// 本機開發判定。除了 localhost，也認私有網段 IP，這樣同一個 WiFi 下的手機
// 連 http://<mac-ip>:5002 時仍然走本地 emulator + 本地 backend，
// 而不是誤連正式 Cloud Run（目前 billing 關閉，會 503）。
const HOSTNAME = window.location.hostname;
const PRIVATE_IP_RE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const NATIVE_DEV_HOST_KEY = 'phubbing_native_dev_host';
const PRODUCTION_BACKEND_HOST = 'phubbing-backend-798458690617.asia-east1.run.app';
const nativeRuntimeConfig = window.PHUBBING_NATIVE_CONFIG || {};
const isNativeApp = Boolean(
    window.Capacitor?.isNativePlatform?.()
    || ['ios', 'android'].includes(window.Capacitor?.getPlatform?.())
);

function normalizeHost(value) {
    return String(value || '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/:\d+$/, '');
}

function readNativeDevHost() {
    if (!isNativeApp) return '';
    const params = new URLSearchParams(window.location.search || '');
    const queryHost = normalizeHost(params.get('devHost'));
    if (queryHost) {
        try { localStorage.setItem(NATIVE_DEV_HOST_KEY, queryHost); } catch (_) {}
        return queryHost;
    }
    try {
        const storedHost = normalizeHost(localStorage.getItem(NATIVE_DEV_HOST_KEY));
        if (storedHost) return storedHost;
    } catch (_) {}
    return normalizeHost(nativeRuntimeConfig.devHost);
}

const nativeDevHost = readNativeDevHost();
const nativeBackendHost = normalizeHost(nativeRuntimeConfig.backendHost) || PRODUCTION_BACKEND_HOST;
const isLocalFrontend = isNativeApp
    ? Boolean(nativeDevHost)
    : ['localhost', '127.0.0.1'].includes(HOSTNAME)
    || PRIVATE_IP_RE.test(HOSTNAME);

export const IS_LOCAL_FRONTEND = isLocalFrontend;
export const IS_NATIVE_APP = isNativeApp;
export const NATIVE_DEV_HOST_STORAGE_KEY = NATIVE_DEV_HOST_KEY;

// 瀏覽器本地一律沿用「這個頁面是從哪個 host 載入的」；原生殼則必須顯式指定開發機 LAN IP。
const runtimeHost = isNativeApp ? nativeDevHost : HOSTNAME;

export const BACKEND_HOST = isLocalFrontend && runtimeHost
    ? `${runtimeHost}:8080`
    : nativeBackendHost;

const backendUsesHttps = !isLocalFrontend;
export const isSecure = isNativeApp
    ? backendUsesHttps
    : window.location.protocol === 'https:';
export const HTTP_PROTOCOL = isSecure ? 'https://' : 'http://';
export const WS_PROTOCOL = isSecure ? 'wss://' : 'ws://';

export const FIREBASE_EMULATORS = {
    enabled: isLocalFrontend,
    authHost: `http://${runtimeHost}:9099`,
    storageHost: runtimeHost,
    storagePort: 9199,
};

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

// 目前有對應透明素材的四種身體；避免顯示能選、實際卻不生效的假選項。
export const PET_BODY_OPTIONS = ['🐶', '🐱', '🐰', '🦊'];
