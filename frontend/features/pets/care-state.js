// Mirrors the server's eligibility messages; the API remains authoritative.
export function careAvailability(pet, action, { busy = false, pending = null } = {}) {
    if (!pet?.pet_face_url) return { disabled: true, label: '先領養寵物' };
    if (busy) return { disabled: true, label: '互動中' };
    if (pending === action) return { disabled: false, label: '重試確認結果' };
    if (pending) return { disabled: true, label: '先確認上一筆互動' };
    if (pet.pet_is_caged) return { disabled: true, label: '完成聚會解鎖' };
    const remaining = Math.max(0, Math.ceil(Number(pet.pet_cooldowns?.[action]) || 0));
    if (remaining) return { disabled: true, remaining };
    if (action === 'feed' && pet.pet_energy >= 95) return { disabled: true, label: '現在很飽' };
    if (action === 'wipe' && pet.pet_cleanliness >= 95) return { disabled: true, label: '現在很乾淨' };
    if (action === 'play' && pet.pet_energy < 12) return { disabled: true, label: '先吃一點東西' };
    if (action === 'play' && pet.pet_happiness >= 95) return { disabled: true, label: '先休息一下' };
    return { disabled: false, label: '可互動' };
}
