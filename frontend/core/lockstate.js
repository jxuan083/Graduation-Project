// core/lockstate.js — 讀取「裝置是否鎖定」的原生訊號（Capacitor LockState plugin）。
//
// 用途：分心偵測要能分辨「在 App 裡按關螢幕鍵（鎖定）」與「切去別的 app」。
// Page Visibility API 兩者都只給 hidden，無法區分；只有原生層知道裝置有沒有鎖定。
//   - iOS：protectedDataWillBecomeUnavailable / DidBecomeAvailable
//   - Android：ACTION_SCREEN_OFF / ACTION_USER_PRESENT + KeyguardManager
//
// 安全網：桌機 / 沒裝 plugin / iOS 未設密碼 → getLockState() 回 null，
// 呼叫端一律 fallback 回原本的行為，不會壞掉。

const GET_STATE_TIMEOUT_MS = 500;

// 事件推送來的快取，getState() 失敗時當備援。
let cached = { locked: false, lastLockedAt: 0, lastUnlockedAt: 0 };
let listenerBound = false;

function getPlugin() {
    return window.Capacitor?.Plugins?.LockState || null;
}

export function lockStateAvailable() {
    return !!getPlugin();
}

function ensureListener(plugin) {
    if (listenerBound || !plugin?.addListener) return;
    listenerBound = true;
    try {
        plugin.addListener('lockStateChange', (e) => {
            if (!e) return;
            cached = {
                locked: !!e.locked,
                lastLockedAt: Number(e.lastLockedAt) || (e.locked ? Date.now() : cached.lastLockedAt),
                lastUnlockedAt: Number(e.lastUnlockedAt) || (!e.locked ? Date.now() : cached.lastUnlockedAt),
            };
        });
    } catch (_) { /* addListener 不可用時忽略，改用 getState pull */ }
}

// 回傳 { locked, lastLockedAt, lastUnlockedAt }（時間為 epoch ms），或 null（無原生訊號）。
// 一定不會 hang：getState 超過 500ms 就退回快取值。
export async function getLockState() {
    const plugin = getPlugin();
    if (!plugin) return null;
    ensureListener(plugin);

    if (typeof plugin.getState === 'function') {
        try {
            const s = await Promise.race([
                plugin.getState(),
                new Promise((resolve) => setTimeout(() => resolve(null), GET_STATE_TIMEOUT_MS)),
            ]);
            if (s) {
                cached = {
                    locked: !!s.locked,
                    lastLockedAt: Number(s.lastLockedAt) || 0,
                    lastUnlockedAt: Number(s.lastUnlockedAt) || 0,
                };
            }
        } catch (_) { /* 用快取值 */ }
    }
    return cached;
}
