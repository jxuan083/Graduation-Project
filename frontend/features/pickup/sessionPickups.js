// features/pickup/sessionPickups.js — 聚會中「拿起手機」的個人回饋卡（只有自己看得到，不影響分數）
//
// 聚會正式開始（定錨完成，App 在前景）時請原生開始錄加速度：由協同處理器代錄，鎖螢幕、App 在背景
// 都照錄，資料只留在這支手機上。聚會結束或自己離開時，分析這段時間，在總結頁顯示一張溫和語氣的卡片，
// 區分「順手看一下／移動位置」與「停留比較久」。演算法在原生 LockStatePlugin.analyzePickups。
// 文案刻意不用「分心」二字（總結頁的「分心 N 次」是計分用的，跟這張卡無關）。
// 網頁、模擬器、不支援動作錄製或沒給「動作與健身」權限時，卡片不出現。
import { state } from '../../core/state.js';
import { t } from '../../core/i18n.js';

const MAX_RECORD_SEC = 12 * 3600;   // CMSensorRecorder 單次錄製上限 12 小時
const RETRY_COUNT = 8;              // 剛結束時最後幾分鐘的資料可能還沒寫進去，最多等約 40 秒
const RETRY_GAP_MS = 5000;

let _from = 0;          // 這場聚會開始錄的時間（加回時沿用同一場的起點）
let _roomId = null;
let _renderToken = 0;

function plugin() {
    const p = window.Capacitor?.Plugins?.LockState;
    return p && typeof p.startMotionRecording === 'function' && typeof p.analyzePickups === 'function' ? p : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 聚會正式開始（或中途加入、加回）時呼叫。
export async function startSessionPickupRecording() {
    const p = plugin();
    if (!p) return;
    if (_roomId !== state.roomId || !_from) {
        _roomId = state.roomId;
        _from = Date.now();
    }
    const expectedSec = (Number(state.currentExpectedDuration) || 90) * 60;
    const durationSec = Math.min(MAX_RECORD_SEC, Math.max(2 * 3600, expectedSec * 2));
    try { await p.startMotionRecording({ durationSec }); } catch (_) { /* 不支援就不顯示卡片 */ }
}

function card() {
    return {
        root: document.getElementById('summary-pickup-card'),
        main: document.getElementById('summary-pickup-main'),
        sub: document.getElementById('summary-pickup-sub'),
    };
}

export function hidePickupCard() {
    _renderToken++;
    const { root } = card();
    if (root) root.style.display = 'none';
}

function feedbackText(res) {
    const n = Number(res.pickups) || 0;
    const long = Number(res.counts?.distracted) || 0;
    let main;
    let sub;
    if (n === 0) {
        main = t('這場聚會你幾乎沒有拿起手機。');
        sub = t('注意力都留給了身邊的人，很棒。');
    } else if (long === 0) {
        main = t('這場聚會你拿起手機 {n} 次，都只是順手看一下或移動位置。', { n });
        sub = t('這樣的節奏很剛好，繼續保持。');
    } else {
        main = t('這場聚會你拿起手機 {n} 次，其中 {k} 次停留比較久。', { n, k: long });
        sub = t('下次想看手機時，可以先跟大家說一聲，或按「需要用一下手機」。');
    }
    const steps = Number(res.movement?.steps) || 0;
    if (state.currentContext === 'outdoor' && steps > 0) {
        sub += ' ' + t('今天一起走了 {n} 步。', { n: steps.toLocaleString() });
    }
    return { main, sub };
}

// 進入總結頁時呼叫。final=true 表示聚會結束（之後重新計）；自己先離開則保留起點，加回後接著算。
export async function renderSessionPickupCard({ final = true } = {}) {
    const token = ++_renderToken;
    const p = plugin();
    const { root, main, sub } = card();
    const from = _from;
    const roomId = _roomId;
    if (final) { _from = 0; _roomId = null; }
    if (!root || !p || !from || roomId !== state.roomId) { if (root) root.style.display = 'none'; return; }

    const to = Date.now();
    main.textContent = t('正在整理這場聚會拿起手機的情形…');
    sub.textContent = t('只在你的手機上分析，不會影響分數。');
    root.style.display = '';

    let res = null;
    for (let i = 0; i < RETRY_COUNT; i++) {
        try {
            res = await p.analyzePickups({ fromMs: from, toMs: to, context: state.currentContext || 'general' });
        } catch (_) {
            res = null;
        }
        if (token !== _renderToken) return;   // 已經換到別的畫面或別場總結
        if (res?.ok && res.coverageSec >= ((to - from) / 1000) * 0.85) break;
        if (res && res.ok === false && res.reason === 'unavailable') break;
        await sleep(RETRY_GAP_MS);
        if (token !== _renderToken) return;
    }
    if (!res?.ok) { root.style.display = 'none'; return; }
    const text = feedbackText(res);
    main.textContent = text.main;
    sub.textContent = text.sub;
}
