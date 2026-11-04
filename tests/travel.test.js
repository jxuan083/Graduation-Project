// 旅行「移動中不算分心」的計算：用假的 iPhone 動作紀錄驗證扣掉移動時間後的分心次數
import test from 'node:test';
import assert from 'node:assert/strict';
import { movingMsFromSummary, deviationsDue } from '../frontend/core/travel.js';

const MIN = 60_000;
const GRACE_L = 30_000;   // 旅行預設輕鬆：寬限 30 秒

// buffer.js 的流程：離開時截止 = 離開 + 寬限；回來時截止往後推「移動的時間」，再補算
function travelDeviations({ awayMs, summary, graceMs = GRACE_L }) {
    const hiddenAt = 1_000_000;
    const now = hiddenAt + awayMs;
    const deadline = hiddenAt + graceMs + movingMsFromSummary(summary, hiddenAt, now);
    return deviationsDue(deadline, now, graceMs);
}

test('walking the whole time away does not count as a distraction', () => {
    assert.equal(travelDeviations({ awayMs: 10 * MIN, summary: { walkingSec: 600 } }), 0);
});

test('only the time standing still counts: 8 min walking + 2 min still = same as 2 min away', () => {
    const mixed = travelDeviations({ awayMs: 10 * MIN, summary: { walkingSec: 480, stationarySec: 120 } });
    const stillOnly = travelDeviations({ awayMs: 2 * MIN, summary: { stationarySec: 120 } });
    assert.equal(mixed, stillOnly);
    assert.equal(stillOnly, 4);   // 2 分鐘：過了 30 秒寬限後 90 秒 → 1 + 3
});

test('riding in a vehicle, cycling and running also count as moving', () => {
    assert.equal(travelDeviations({ awayMs: 20 * MIN, summary: { automotiveSec: 900, cyclingSec: 200, runningSec: 100 } }), 0);
});

test('no movement data (simulator, no permission, web) falls back to the normal rule', () => {
    const normal = deviationsDue(1_000_000 + GRACE_L, 1_000_000 + 5 * MIN, GRACE_L);
    assert.equal(travelDeviations({ awayMs: 5 * MIN, summary: null }), normal);
    assert.equal(travelDeviations({ awayMs: 5 * MIN, summary: { stationarySec: 300 } }), normal);
});

test('movement can never cancel more than the time actually away', () => {
    assert.equal(movingMsFromSummary({ walkingSec: 99999 }, 0, 5 * MIN), 5 * MIN);
    assert.equal(movingMsFromSummary({ walkingSec: -50 }, 0, 5 * MIN), 0);
});

test('coming back within the grace period is free', () => {
    assert.equal(travelDeviations({ awayMs: 20_000, summary: {} }), 0);
});
