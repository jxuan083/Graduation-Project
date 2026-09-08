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

// ── 聚會設定頁「顯示用」資料 ──
// 意圖暫離的次數/時長是顯示給使用者看的；真正的 enforcement 在後端 backend/intent.py。
// 這裡是鏡像，且由 tests/project-invariants 讀後端比對，確保兩邊永遠一致（不會顯示錯）。
export const EXEMPT_BUDGET_BY_CONTEXT = {
    general: 2, meeting: 0, family: 3, study: 2, class: 0,
    meal: 3, date: 1, celebration: 3, workshop: 2, team: 2, custom: 2,
};
export const EXEMPT_WINDOW_SEC = { L: 180, M: 120, H: 60 };

// 每個情境選定後顯示的一句注意事項（口語、非評分細節）。
export const CONTEXT_NOTES = {
    general:     '輕鬆聊天為主，手機偶爾看一下沒關係。',
    meeting:     '正式場合，建議全程專注，不開放暫離。',
    family:      '家庭聚會比較彈性，家人有急事可以暫離一下。',
    study:       '讀書會重視專注，查資料可以短暫暫離。',
    class:       '最嚴格模式，任何分心都會記錄，不開放暫離。',
    meal:        '用餐可以拍照、看菜單，手機使用比較寬容。',
    date:        '重視兩人相處，盡量別一直看手機。',
    celebration: '慶祝場合，拍照留念很歡迎，手機使用寬鬆。',
    workshop:    '工作坊需要時可查資料，建議專注參與。',
    team:        '團隊活動以互動為主，適度使用手機。',
    custom:      '自訂場景，依你設定的難度計分。',
};
