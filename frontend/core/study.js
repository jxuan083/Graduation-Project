// core/study.js — 讀書會番茄鐘的時段計算（純函式，跟 backend/study.py 同一套算法，可以單元測試）
//
// 聚會正式開始後全組一起跑「專心 25 分鐘、休息 5 分鐘」；休息時段全員可以用手機（不算分心、不用暫離）。
// 開始時間是後端的時間點，呼叫前要先換成手機時間（phoneOpen.js 的 toLocalMs）。
// 不 import config.js（它一載入就讀 window），單元測試才能直接跑；數值由 tests/project-invariants 對後端。

export const STUDY_FOCUS_MIN = 25;
export const STUDY_BREAK_MIN = 5;
const FOCUS_MS = STUDY_FOCUS_MIN * 60_000;
const CYCLE_MS = (STUDY_FOCUS_MIN + STUDY_BREAK_MIN) * 60_000;

// { onBreak, breakStart, breakEnd }：現在是不是休息時段，以及這次（或下一次）休息的起訖
export function breakWindow(startedMs, nowMs) {
    if (!startedMs || nowMs < startedMs) return { onBreak: false, breakStart: startedMs + FOCUS_MS, breakEnd: startedMs + CYCLE_MS };
    const cycleStart = startedMs + Math.floor((nowMs - startedMs) / CYCLE_MS) * CYCLE_MS;
    const breakStart = cycleStart + FOCUS_MS;
    const breakEnd = cycleStart + CYCLE_MS;
    return { onBreak: nowMs >= breakStart && nowMs < breakEnd, breakStart, breakEnd };
}

// [a, b] 之間落在休息時段的毫秒數（離開 App 期間碰到休息，那段不算分心）
export function breakOverlapMs(startedMs, aMs, bMs) {
    if (!startedMs || !(bMs > aMs)) return 0;
    let total = 0;
    for (let k = Math.max(0, Math.floor((aMs - startedMs) / CYCLE_MS)); ; k++) {
        const bStart = startedMs + k * CYCLE_MS + FOCUS_MS;
        const bEnd = bStart + (CYCLE_MS - FOCUS_MS);
        if (bStart >= bMs) break;
        total += Math.max(0, Math.min(bEnd, bMs) - Math.max(bStart, aMs));
    }
    return total;
}

// 接下來 n 次休息的起訖（排通知用）
export function upcomingBreaks(startedMs, nowMs, n) {
    const out = [];
    if (!startedMs) return out;
    let { breakStart, breakEnd } = breakWindow(startedMs, nowMs);
    for (let i = 0; i < n; i++) {
        out.push({ start: breakStart, end: breakEnd });
        breakStart += CYCLE_MS; breakEnd += CYCLE_MS;
    }
    return out;
}
