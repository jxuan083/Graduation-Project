import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dict } from '../frontend/core/i18n-dict.js';

test('dict has en table', () => {
  assert.ok(dict && typeof dict.en === 'object');
});

test('all values are non-empty strings', () => {
  for (const [k, v] of Object.entries(dict.en)) {
    assert.equal(typeof v, 'string', `value for "${k}" not a string`);
    assert.ok(v.trim().length > 0, `value for "${k}" is empty`);
  }
});

test('no key has leading/trailing whitespace', () => {
  for (const k of Object.keys(dict.en)) {
    assert.equal(k, k.trim(), `key "${k}" has outer whitespace`);
  }
});

test('placeholder parity: same {tokens} on both sides', () => {
  const tokens = (s) => (s.match(/\{(\w+)\}/g) || []).sort();
  for (const [k, v] of Object.entries(dict.en)) {
    assert.deepEqual(tokens(v), tokens(k), `token mismatch for "${k}"`);
  }
});

test('known seed entries present', () => {
  assert.equal(dict.en['聚會時間'], 'Meeting Time');
  assert.equal(dict.en['發起聚會'], 'Start a Gathering');
});
