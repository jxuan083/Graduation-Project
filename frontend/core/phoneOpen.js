// core/phoneOpen.js — 主持人「開放使用手機」（開會、專心上課）與旅行「休息一下」的狀態判斷
//
// 旅行的休息（mode = "rest"）也放在 phone_open：大家投票開始／結束，最長 30 分鐘。
// 可能被提前投票結束，所以跟「直到結束」一樣不在前端算超時（回來時由後端補算）。
//
// 後端 room.phone_open 隨 ROOM_UPDATE 廣播，存在 state.phoneOpen。開放中離開 App 不算分心、算專心。
//   限時（只有上課）：until_ms 是結束時間，事先知道 → 手機自己排通知、靈動島倒數，回來時照一般方式補算。
//   直到結束（until_ms = 0）：主持人按「結束開放」才結束；那時還在 App 外的人收不到即時通知，
//     回到 App 時由後端補算（PHONE_OPEN_OVERAGE）。
import { state } from './state.js';
import { PHONE_OPEN_MODES } from './config.js';

// 後端的時間點 → 手機時間（手機時鐘跟伺服器差多少都沒關係）
export function toLocalMs(serverMs) {
    const ms = Number(serverMs || 0);
    return ms ? ms + (Number(state.serverClockOffset) || 0) : 0;
}

// 後端的 phone_open 換成手機時間；key 保留原始開始時間，用來判斷是不是同一次開放
export function localizePhoneOpen(po) {
    if (!po) return null;
    return {
        ...po,
        key: Number(po.since_ms || 0),
        since_ms: toLocalMs(po.since_ms),
        until_ms: toLocalMs(po.until_ms),
        ended_ms: toLocalMs(po.ended_ms),
    };
}

export function phoneOpenModes(context = state.currentContext) {
    return PHONE_OPEN_MODES[context] || [];
}

export function phoneOpenActive(now = Date.now()) {
    const po = state.phoneOpen;
    if (!po || po.ended_ms) return false;
    const until = Number(po.until_ms || 0);
    return until === 0 || now < until;
}

// 老師限時開放：結束時間確定（不能提前結束），由前端照一般方式補算
export function phoneOpenTimed() {
    return state.phoneOpen?.mode === 'timed';
}

export function phoneOpenIsRest() {
    return state.phoneOpen?.mode === 'rest';
}

// buffer.js 用：離開 App 時從何時開始算分心。直到結束的開放、休息中 → 無限遠（回來時由後端補算）。
export function phoneOpenUntilMs(now = Date.now()) {
    if (!phoneOpenActive(now)) return 0;
    return phoneOpenTimed() ? Number(state.phoneOpen.until_ms) : Infinity;
}

// 這次開放結束的時間（還在開放中或沒開放過 → 0）
export function phoneOpenEndedMs(now = Date.now()) {
    const po = state.phoneOpen;
    if (!po) return 0;
    if (po.ended_ms) return Number(po.ended_ms);
    const until = Number(po.until_ms || 0);
    return until && now >= until ? until : 0;
}
