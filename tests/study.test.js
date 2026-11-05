// 讀書會番茄鐘的時段計算（跟 backend/study.py 的測試用同一組數字）
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakWindow, breakOverlapMs, upcomingBreaks } from '../frontend/core/study.js';

const MIN = 60_000;
const T0 = 1_000_000_000_000;

test('25 minutes focus then 5 minutes break, repeating', () => {
    assert.deepEqual(breakWindow(T0, T0 + 10 * MIN), { onBreak: false, breakStart: T0 + 25 * MIN, breakEnd: T0 + 30 * MIN });
    assert.equal(breakWindow(T0, T0 + 25 * MIN).onBreak, true);
    assert.equal(breakWindow(T0, T0 + 30 * MIN).onBreak, false);
    assert.deepEqual(breakWindow(T0, T0 + 57 * MIN), { onBreak: true, breakStart: T0 + 55 * MIN, breakEnd: T0 + 60 * MIN });
});

test('time away that overlaps breaks is not counted', () => {
    assert.equal(breakOverlapMs(T0, T0 + 10 * MIN, T0 + 20 * MIN), 0);
    assert.equal(breakOverlapMs(T0, T0 + 20 * MIN, T0 + 40 * MIN), 5 * MIN);
    assert.equal(breakOverlapMs(T0, T0 + 27 * MIN, T0 + 28 * MIN), 1 * MIN);
    assert.equal(breakOverlapMs(T0, T0 + 20 * MIN, T0 + 90 * MIN), 15 * MIN);
});

test('upcoming breaks for scheduling notifications', () => {
    const next = upcomingBreaks(T0, T0 + 26 * MIN, 2);
    assert.deepEqual(next, [{ start: T0 + 25 * MIN, end: T0 + 30 * MIN }, { start: T0 + 55 * MIN, end: T0 + 60 * MIN }]);
});
