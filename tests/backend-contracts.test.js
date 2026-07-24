import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const backend = readFileSync(new URL('../backend/main.py', import.meta.url), 'utf8');
const contract = readFileSync(
  new URL('../docs/superpowers/specs/2026-07-23-api-ws-contract.md', import.meta.url),
  'utf8',
);

function websocketSource() {
  const start = backend.indexOf('@app.websocket("/ws/{room_id}/{user_id}")');
  assert.ok(start >= 0, 'WebSocket endpoint decorator must exist');
  return backend.slice(start);
}

test('REST route surface stays compatible with the Phase 0 contract', () => {
  const actual = [...backend.matchAll(/@app\.(get|post|patch|delete|put)\("([^"]+)"\)/g)]
    .map(match => `${match[1].toUpperCase()} ${match[2]}`);

  const expected = [
    'GET /api/version',
    'GET /api/health',
    'GET /api/qrcode',
    'GET /api/me',
    'POST /api/profile',
    'GET /api/users/{target_uid}/public',
    'GET /api/users/by_handle/{handle}',
    'GET /api/users/{target_uid}/card',
    'POST /api/push_token',
    'GET /api/users/{target_uid}/relationship',
    'POST /api/friend_requests',
    'GET /api/friend_requests',
    'POST /api/friend_requests/{req_id}/accept',
    'POST /api/friend_requests/{req_id}/decline',
    'POST /api/friend_requests/{req_id}/withdraw',
    'GET /api/friends',
    'DELETE /api/friends/{friend_uid}',
    'GET /api/leaderboard/global',
    'GET /api/leaderboard/friends',
    'GET /api/meetings',
    'PATCH /api/meetings/{meeting_id}/favorite',
    'DELETE /api/meetings/{meeting_id}',
    'GET /api/meetings/{meeting_id}',
    'GET /api/questions',
    'POST /api/questions',
    'PATCH /api/questions/{qid}',
    'DELETE /api/questions/{qid}',
    'GET /api/public_questions',
    'POST /api/questions/import',
    'POST /api/meetings/{meeting_id}/photos',
    'GET /api/meetings/{meeting_id}/photos',
    'GET /api/meetings/{meeting_id}/photos/{photo_id}/content',
    'DELETE /api/meetings/{meeting_id}/photos/{photo_id}',
    'PATCH /api/meetings/{meeting_id}/photos/{photo_id}/cover',
    'POST /api/meetings/{meeting_id}/transcripts',
    'POST /api/meetings/{meeting_id}/transcripts/audio',
    'GET /api/meetings/{meeting_id}/transcripts',
    'POST /api/meetings/{meeting_id}/newspaper/generate',
    'GET /api/meetings/{meeting_id}/newspaper',
    'POST /api/groups',
    'GET /api/groups',
    'GET /api/groups/{group_id}',
    'GET /api/groups/{group_id}/messages',
    'POST /api/groups/{group_id}/messages',
    'GET /api/groups/{group_id}/meetings',
    'PATCH /api/groups/{group_id}',
    'POST /api/groups/{group_id}/members',
    'DELETE /api/groups/{group_id}/members/{target_uid}',
    'PATCH /api/groups/{group_id}/pet',
    'GET /api/groups/{group_id}/pet',
    'POST /api/groups/{group_id}/pet-face',
    'POST /api/groups/{group_id}/pet/action',
    'GET /api/group-pets',
    'DELETE /api/groups/{group_id}/pet',
    'GET /api/group_invite/{code}',
    'POST /api/group_invite/join',
    'POST /api/groups/{group_id}/invite_code/refresh',
    'GET /api/context_defaults',
    'POST /api/create_room',
    'POST /api/rooms/{room_id}/end',
  ];

  assert.deepEqual(actual, expected);
  for (const route of expected) {
    const [method, path] = route.split(' ');
    assert.match(contract, new RegExp(`\\| ${method} \\| \`${path.replace(/[{}]/g, '\\$&')}\` \\|`));
  }
});

test('WebSocket action and message surface stays compatible with the Phase 0 contract', () => {
  const ws = websocketSource();
  const inbound = new Set(['AUTH']);
  for (const match of ws.matchAll(/(?:if|elif) action == "([^"]+)"/g)) inbound.add(match[1]);

  const outbound = new Set();
  for (const match of ws.matchAll(/"type": "([^"]+)"/g)) outbound.add(match[1]);
  if (ws.includes('msg_type = "USER_WOKE_SCREEN" if state == "visible" else "USER_HID_SCREEN"')) {
    outbound.add('USER_WOKE_SCREEN');
    outbound.add('USER_HID_SCREEN');
  }

  const expectedInbound = [
    'AUTH',
    'START_SYNC',
    'CANCEL_ROOM',
    'END_SESSION',
    'CHANGE_MODE',
    'START_QA',
    'SUBMIT_ANSWER',
    'SYNC_PROGRESS',
    'VISIBILITY_CHANGE',
    'LOG_DEVIATION',
    'START_TABOO_GAME',
    'END_TABOO_GAME',
  ];
  const expectedOutbound = [
    'AUTH_OK',
    'ROOM_UPDATE',
    'SYNC_STARTED',
    'ROOM_CANCELLED',
    'SESSION_ENDED',
    'MODE_CHANGED',
    'QA_ERROR',
    'QA_STARTED',
    'QA_PROGRESS',
    'QA_FINISHED',
    'ANCHOR_ESTABLISHED',
    'PROGRESS_UPDATE',
    'USER_WOKE_SCREEN',
    'USER_HID_SCREEN',
    'DEVIATION_RECORDED',
    'TABOO_STARTED',
    'TABOO_ENDED',
  ];

  assert.deepEqual([...inbound].sort(), expectedInbound.sort());
  assert.deepEqual([...outbound].sort(), expectedOutbound.sort());
  for (const action of expectedInbound) assert.match(contract, new RegExp(`\\| \`${action}\` \\|`));
  for (const type of expectedOutbound) assert.match(contract, new RegExp(`\\| \`${type}\` \\|`));
});
