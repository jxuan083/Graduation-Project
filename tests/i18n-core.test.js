import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, translate } from '../frontend/core/i18n-core.js';

test('interpolate fills placeholders', () => {
  assert.equal(interpolate('你好 {name}', { name: 'A' }), '你好 A');
});

test('interpolate keeps unknown placeholders', () => {
  assert.equal(interpolate('x {a} {b}', { a: 1 }), 'x 1 {b}');
});

test('interpolate with no params returns template unchanged', () => {
  assert.equal(interpolate('plain text'), 'plain text');
});

const dict = {
  en: {
    '聚會時間': 'Meeting Time',
    '加入群組「{name}」（{count} 位成員）？': 'Join group "{name}" ({count} members)?',
  },
};

test('translate en: hit returns english', () => {
  assert.equal(translate(dict, 'en', '聚會時間'), 'Meeting Time');
});

test('translate en: miss falls back to zh key', () => {
  assert.equal(translate(dict, 'en', '未知字串'), '未知字串');
});

test('translate zh: returns zh with params filled', () => {
  assert.equal(
    translate(dict, 'zh', '加入群組「{name}」（{count} 位成員）？', { name: '甲', count: 3 }),
    '加入群組「甲」（3 位成員）？'
  );
});

test('translate en: with params', () => {
  assert.equal(
    translate(dict, 'en', '加入群組「{name}」（{count} 位成員）？', { name: 'X', count: 2 }),
    'Join group "X" (2 members)?'
  );
});
