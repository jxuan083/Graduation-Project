// core/phoneOpen.js — 主持人「開放使用手機」的狀態判斷（開會、專心上課）
//
// 後端 room.phone_open 隨 ROOM_UPDATE 廣播，存在 state.phoneOpen。開放中離開 App 不算分心、算專心。
//   限時（只有上課）：until_ms 是結束時間，事先知道 → 手機自己排通知、靈動島倒數，回來時照一般方式補算。
//   直到結束（until_ms = 0）：主持人按「結束開放」才結束；那時還在 App 外的人收不到即時通知，
//     回到 App 時由後端補算（PHONE_OPEN_OVERAGE）。
import { state } from './state.js';
import { PHONE_OPEN_MODES } from './config.js';

export function phoneOpenModes(context = state.currentContext) {
    return PHONE_OPEN_MODES[context] || [];
}

export function phoneOpenActive(now = Date.now()) {
    const po = state.phoneOpen;
    if (!po || po.ended_ms) return false;
    const until = Number(po.until_ms || 0);
    return until === 0 || now < until;
}

export function phoneOpenTimed() {
    return Number(state.phoneOpen?.until_ms || 0) > 0;
}

// buffer.js 用：離開 App 時從何時開始算分心。直到結束的開放中 → 無限遠（回來時由後端補算）。
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
