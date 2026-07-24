# API 與 WebSocket characterization contract

日期：2026-07-23
狀態：Phase 0 baseline；記錄現況，不代表最終理想架構。

## REST routes

這份清單來自 `backend/main.py` 的 FastAPI decorators。Phase 1/2 重構時，除非另外做 migration note，path 與 method 要維持相容。

| Method | Path |
|---|---|
| GET | `/api/version` |
| GET | `/api/health` |
| GET | `/api/qrcode` |
| GET | `/api/me` |
| POST | `/api/profile` |
| GET | `/api/users/{target_uid}/public` |
| GET | `/api/users/by_handle/{handle}` |
| GET | `/api/users/{target_uid}/card` |
| POST | `/api/push_token` |
| GET | `/api/users/{target_uid}/relationship` |
| POST | `/api/friend_requests` |
| GET | `/api/friend_requests` |
| POST | `/api/friend_requests/{req_id}/accept` |
| POST | `/api/friend_requests/{req_id}/decline` |
| POST | `/api/friend_requests/{req_id}/withdraw` |
| GET | `/api/friends` |
| DELETE | `/api/friends/{friend_uid}` |
| GET | `/api/leaderboard/global` |
| GET | `/api/leaderboard/friends` |
| GET | `/api/meetings` |
| PATCH | `/api/meetings/{meeting_id}/favorite` |
| DELETE | `/api/meetings/{meeting_id}` |
| GET | `/api/meetings/{meeting_id}` |
| GET | `/api/questions` |
| POST | `/api/questions` |
| PATCH | `/api/questions/{qid}` |
| DELETE | `/api/questions/{qid}` |
| GET | `/api/public_questions` |
| POST | `/api/questions/import` |
| POST | `/api/meetings/{meeting_id}/photos` |
| GET | `/api/meetings/{meeting_id}/photos` |
| GET | `/api/meetings/{meeting_id}/photos/{photo_id}/content` |
| DELETE | `/api/meetings/{meeting_id}/photos/{photo_id}` |
| PATCH | `/api/meetings/{meeting_id}/photos/{photo_id}/cover` |
| POST | `/api/meetings/{meeting_id}/transcripts` |
| POST | `/api/meetings/{meeting_id}/transcripts/audio` |
| GET | `/api/meetings/{meeting_id}/transcripts` |
| POST | `/api/meetings/{meeting_id}/newspaper/generate` |
| GET | `/api/meetings/{meeting_id}/newspaper` |
| POST | `/api/groups` |
| GET | `/api/groups` |
| GET | `/api/groups/{group_id}` |
| GET | `/api/groups/{group_id}/messages` |
| POST | `/api/groups/{group_id}/messages` |
| GET | `/api/groups/{group_id}/meetings` |
| PATCH | `/api/groups/{group_id}` |
| POST | `/api/groups/{group_id}/members` |
| DELETE | `/api/groups/{group_id}/members/{target_uid}` |
| PATCH | `/api/groups/{group_id}/pet` |
| GET | `/api/groups/{group_id}/pet` |
| POST | `/api/groups/{group_id}/pet-face` |
| POST | `/api/groups/{group_id}/pet/action` |
| GET | `/api/group-pets` |
| DELETE | `/api/groups/{group_id}/pet` |
| GET | `/api/group_invite/{code}` |
| POST | `/api/group_invite/join` |
| POST | `/api/groups/{group_id}/invite_code/refresh` |
| GET | `/api/context_defaults` |
| POST | `/api/create_room` |
| POST | `/api/rooms/{room_id}/end` |

## WebSocket endpoint

| Endpoint | Note |
|---|---|
| `/ws/{room_id}/{user_id}` | First frame must be `AUTH`. Guest `user_id` must be UUID4; signed-in users must send Firebase ID token matching path UID. |

## Inbound WebSocket actions

| Action | Current behavior |
|---|---|
| `AUTH` | Required first frame. Returns `AUTH_OK` on success. |
| `START_SYNC` | Host-only. Valid only from `WAITING`; resets member progress and broadcasts `SYNC_STARTED`. |
| `CANCEL_ROOM` | Host-only. Valid only from `WAITING`; marks room `CANCELLED`. |
| `END_SESSION` | Ends room, broadcasts summary payload, writes meeting mirror data and group pet reward. |
| `CHANGE_MODE` | Host-only, mode allowlist: `GATHERING`, `FAMILY`, `MEETING`, `CLASS`. |
| `START_QA` | Host-only. Starts QA mode from own/public/specific question or legacy inline payload. |
| `SUBMIT_ANSWER` | Accepts only active QA answers matching current options; first answer wins. |
| `SYNC_PROGRESS` | Valid only in `SYNCING`; clamps progress to `0..100`; all members at 100 moves room to `ACTIVE`. |
| `VISIBILITY_CHANGE` | Updates member visible/hidden state; in active non-QA mode broadcasts wake/hide events. |
| `LOG_DEVIATION` | Records deviation count and broadcasts deviation event. |
| `START_TABOO_GAME` | Starts Taboo game broadcast. |
| `END_TABOO_GAME` | Ends Taboo game broadcast. |

## Outbound WebSocket message types

| Type |
|---|
| `AUTH_OK` |
| `ROOM_UPDATE` |
| `SYNC_STARTED` |
| `ROOM_CANCELLED` |
| `SESSION_ENDED` |
| `MODE_CHANGED` |
| `QA_ERROR` |
| `QA_STARTED` |
| `QA_PROGRESS` |
| `QA_FINISHED` |
| `ANCHOR_ESTABLISHED` |
| `PROGRESS_UPDATE` |
| `USER_WOKE_SCREEN` |
| `USER_HID_SCREEN` |
| `DEVIATION_RECORDED` |
| `TABOO_STARTED` |
| `TABOO_ENDED` |

## Phase 1/2 test upgrade target

Current tests lock source-level contract because local Firebase dependencies are not yet isolated. After local-first setup exists, promote this baseline to:

- FastAPI `TestClient` route tests with fake repository.
- Firebase emulator integration tests for Firestore and Storage behavior.
- WebSocket protocol tests with two in-process clients.
