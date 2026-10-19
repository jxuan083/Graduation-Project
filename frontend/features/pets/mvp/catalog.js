// Stable item IDs can later be referenced by inventory and draw results.
// The MVP grants everything locally; it performs no draw or inventory API calls.
export const CATALOG = Object.freeze({
    characters: { dog: { label: '垂耳狗', rig: 'companion-v1' }, cat: { label: '尖耳貓', rig: 'companion-v1' } },
    outfits: { sage: { label: '鼠尾草綠', color: '#708b77', compatibleRigs: ['companion-v1'] }, rose: { label: '陶土粉', color: '#b77464', compatibleRigs: ['companion-v1'] } },
    toys: { ball: { label: '條紋球', action: 'play' }, bone: { label: '布骨頭', action: 'play' } },
});
export const DEFAULT_EQUIPMENT = Object.freeze({ character: 'dog', outfit: 'sage', toy: 'ball' });
export function validateEquipment(value) {
    const v = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(DEFAULT_EQUIPMENT).map(([kind, fallback]) => [kind,
        Object.hasOwn(CATALOG[{ character: 'characters', outfit: 'outfits', toy: 'toys' }[kind]], v[kind]) ? v[kind] : fallback]));
}
export function toyMarkup(id) {
    return id === 'bone' ? '<svg viewBox="0 0 48 48"><path d="M15 15c-8-9-17 3-8 9-9 6 0 18 8 9h18c8 9 17-3 8-9 9-6 0-18-8-9z" fill="#ebd7af" stroke="#bb9f70" stroke-width="2"/><path d="M18 23h13" stroke="#c0a779" stroke-dasharray="2 3"/></svg>' : '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" fill="#bd7967"/><path d="M12 11c16 8 23 18 24 26M9 34c12-11 21-17 29-18" stroke="#f6d9a2" stroke-width="6" fill="none"/><circle cx="24" cy="24" r="18" stroke="#a66d5e" stroke-width="2" fill="none"/></svg>';
}
