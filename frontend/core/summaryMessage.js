// core/summaryMessage.js — 結算頁寵物文字的分級（純函式，不碰畫面，可以單元測試）
//
// 聚會結束時先用這裡的規則版文字，後端 Qwen 生成的那句（/api/rooms/{id}/summary-message）到了再換上去。
// 分數 = 專注分（扣分心）＋陪伴分（在場越久越高，60 分鐘拿滿），所以分數不高不一定是分心：
// 分心很少、但聚會很短時，要說「時間短」而不是「分心多」。文字是寵物在說話，一律用「我」自稱。

export const SHORT_MINUTES = 30;   // 在場少於這個分鐘數、分心又很少 → 分數不高是因為時間短

export const MASCOT_MESSAGES = {
    great: '太專注了！這場聚會超棒，我獲得了豐盛養分 🎉',
    good: '不錯的一場聚會，我也跟著成長了，下次再更投入一點！',
    short: '這場時間比較短，但你很專注！下次多待一會兒，我會長得更快。',
    try: '這次分心多了些，下次多陪陪彼此，我會更健壯的！',
    abandoned: '這場在結束前跑出 App 沒有回來，我有點寂寞，下次記得回來喔。',
};

export function mascotTier({ score = null, deviations = 0, minutes = 0, abandoned = false } = {}) {
    if (abandoned) return 'abandoned';
    const devs = Math.max(0, Number(deviations) || 0);
    const s = score === null || score === undefined || score === '' ? NaN : Number(score);
    if (!Number.isFinite(s)) {   // 沒有分數（重連漏收結算）：只能看分心次數
        return devs <= 3 ? 'great' : devs <= 8 ? 'good' : 'try';
    }
    if (s >= 85) return 'great';
    if (devs <= 1) return (Number(minutes) || 0) < SHORT_MINUTES ? 'short' : 'good';
    return s >= 60 ? 'good' : 'try';
}
