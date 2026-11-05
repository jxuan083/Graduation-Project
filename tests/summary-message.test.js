import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mascotTier, MASCOT_MESSAGES } from '../frontend/core/summaryMessage.js';

test('沒分心但聚會很短：說時間短，不說分心多', () => {
  assert.equal(mascotTier({ score: 58, deviations: 0, minutes: 3 }), 'short');
  assert.equal(mascotTier({ score: 70, deviations: 1, minutes: 12 }), 'short');
});

test('分數高就稱讚，不管時間長短', () => {
  assert.equal(mascotTier({ score: 92, deviations: 0, minutes: 5 }), 'great');
  assert.equal(mascotTier({ score: 85, deviations: 2, minutes: 90 }), 'great');
});

test('分心多又分數低：提醒分心', () => {
  assert.equal(mascotTier({ score: 40, deviations: 6, minutes: 90 }), 'try');
  assert.equal(mascotTier({ score: 55, deviations: 2, minutes: 10 }), 'try');
});

test('中間的情況', () => {
  assert.equal(mascotTier({ score: 70, deviations: 3, minutes: 60 }), 'good');
  assert.equal(mascotTier({ score: 75, deviations: 0, minutes: 45 }), 'good');   // 待夠久、沒分心，但沒到 85（例如暫離用很多）
});

test('跑出去沒回來（0 分）有自己的說法', () => {
  assert.equal(mascotTier({ score: 0, deviations: 0, minutes: 30, abandoned: true }), 'abandoned');
});

test('沒有分數時只看分心次數（舊行為）', () => {
  assert.equal(mascotTier({ score: null, deviations: 2 }), 'great');
  assert.equal(mascotTier({ score: undefined, deviations: 5 }), 'good');
  assert.equal(mascotTier({ deviations: 9 }), 'try');
});

test('每一級都有文字，而且是寵物用「我」自稱', () => {
  for (const tier of ['great', 'good', 'short', 'try', 'abandoned']) {
    assert.match(MASCOT_MESSAGES[tier], /我/);
    assert.doesNotMatch(MASCOT_MESSAGES[tier], /\{who\}|吉祥物/);
  }
});
