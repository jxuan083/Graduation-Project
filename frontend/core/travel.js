// core/travel.js — 旅行「移動中不算分心」與分心補算的純計算（不碰畫面，可以單元測試）
//
// 回到 App 時，buffer.js 向 iPhone 查「離開期間各種活動的秒數」（原生 LockState.queryMovement），
// 走路、跑步、騎車、搭車的時間不算分心：把分心的起算點往後推這麼多，只算停下來的時間。

const MOVING_KEYS = ['walkingSec', 'runningSec', 'cyclingSec', 'automotiveSec'];

// queryMovement 的結果 → 這段期間「在移動」的毫秒數（最多就是離開的總時間；查不到 → 0，照一般規則算）
export function movingMsFromSummary(summary, fromMs, toMs) {
    if (!summary || !(toMs > fromMs)) return 0;
    const sec = MOVING_KEYS.reduce((sum, k) => sum + Math.max(0, Number(summary[k]) || 0), 0);
    return Math.max(0, Math.min(sec * 1000, toMs - fromMs));
}

// 過了截止時間該補記幾次分心：過了就記 1 次，之後每滿一個寬限再記 1 次（跟後端 phone_open 的算法相同）
export function deviationsDue(deadlineMs, nowMs, graceMs) {
    if (!(nowMs >= deadlineMs) || !(graceMs > 0)) return 0;
    return Math.floor((nowMs - deadlineMs) / graceMs) + 1;
}
