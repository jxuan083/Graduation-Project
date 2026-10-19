// core/ordering.js — 掃碼點餐：App 內建點餐瀏覽器（原生）與「帶出 App」登記（後端）的呼叫
//
// 點餐網頁開在 App 內建的瀏覽器裡，只能在那家的點餐網站裡走動，所以不算分心、不限次數。
// 被點餐網站帶出 App（外部網頁、LINE 點餐、付款 App）時才向後端登記一次「帶出」：
// 每場最多 2 次、每次 15 分鐘內不算分心，回到 App 就結束（規則在 backend/ordering.py）。
// 只有原生 App 有這個功能；網頁版不顯示點餐按鈕。
import { state } from './state.js';
import { apiFetch } from './api.js';
import { t } from './i18n.js';
import { ORDER_CONTEXTS, ORDER_TRIP_LIMIT } from './config.js';

export function orderingPlugin() {
    const p = window.Capacitor?.Plugins?.LockState;
    return p && typeof p.openOrdering === 'function' ? p : null;
}

export function orderingAvailable() {
    return !!orderingPlugin() && ORDER_CONTEXTS.includes(state.currentContext);
}

// 這場還能「帶出 App 點餐」幾次（後端的成員資料為準；還沒收到時當作上限）
export function orderTripsLeft() {
    const used = Number(state.roomMembers?.[state.userId]?.order_trips_used || 0);
    return Math.max(0, ORDER_TRIP_LIMIT - used);
}

// 點餐瀏覽器上的文字（原生畫面讀不到 App 的翻譯字典，由這裡帶過去）
export function orderingLabels() {
    return {
        title: t('點餐中'),
        back: t('回到聚會'),
        extTitle: t('要離開 App 去點餐或付款嗎？'),
        extMessage: t('會打開外部頁面或 App。15 分鐘內不算分心，回到 App 就結束；這場還可以 {n} 次。'),
        extGo: t('前往'),
        extCancel: t('取消'),
        noneTitle: t('這場的次數用完了'),
        noneMessage: t('可以離開 App 點餐的 2 次都用完了。真的需要的話，請回到聚會按「需要用一下手機」。'),
        ok: t('好'),
    };
}

// 登記一次「帶出 App 點餐」。成功回傳 { window_sec, remind_sec, trips_left }。
export async function requestOrderTrip() {
    if (!state.roomId) throw new Error(t('目前不在聚會中'));
    const { res, data } = await apiFetch(`/api/rooms/${state.roomId}/order-trip`, { method: 'POST' });
    if (!res.ok || !data || data.status !== 'success') {
        throw new Error((data && data.detail) || t('現在無法離開 App 點餐'));
    }
    return data;
}
