// utils/format.js — 通用格式化函式
export function formatModeLabel(mode) {
    return ({
        "GATHERING": "🎉 朋友聚會",
        "FAMILY": "🏠 家庭聚會",
        "MEETING": "💼 嚴肅開會",
        "CLASS": "📚 上課模式",
        "QA_GAME": "❓ 團體問答",
        "ACTIVE": "🎉 朋友聚會"
    })[mode] || (mode || '聚會');
}

export function formatEndReason(r) {
    return ({
        "host_ended": "房主結束聚會",
        "host_left": "房主離開了聚會"
    })[r] || (r || '正常結束');
}

export function formatDateTime(iso) {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        if (isNaN(d)) return iso;
        return d.toLocaleString('zh-TW', { hour12: false });
    } catch (_) {
        return iso;
    }
}
