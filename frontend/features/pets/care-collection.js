import { t } from '../../core/i18n.js';

const ART = {
    food: new URL('../../assets/pets/illustrated/care-foods-v1.png', import.meta.url).href,
    toy: new URL('../../assets/pets/illustrated/care-toys-v1.png', import.meta.url).href,
    ball: new URL('../../assets/pets/illustrated/puppy-cloth-ball-v1.png', import.meta.url).href,
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function itemArt(item) {
    const src = ART[item?.visual?.sheet];
    const crop = item?.visual?.crop;
    if (!src || !Array.isArray(crop) || crop.length !== 4 || !crop.every(Number.isFinite)) return '';
    const [x,y,w,h] = crop;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > 1.001 || y+h > 1.001) return '';
    return `<span class="care-art" aria-hidden="true"><span style="aspect-ratio:${w/h};width:${Math.min(100,w/h*100)}%"><img src="${src}" alt="" style="width:${100/w}%;height:${100/h}%;left:${-100*x/w}%;top:${-100*y/h}%"></span></span>`;
}
export function itemEffects(item) {
    return Object.entries(item?.effects || {}).map(([key,n]) => `${t({pet_energy:'飽食',pet_happiness:'快樂'}[key] || key)} ${n>0?'+':''}${n}`).join(' · ');
}
export function itemBadge(item) {
    const tier = ['common','rare','treasure'].includes(item?.rarity) ? item.rarity : 'common';
    return `<span class="care-rarity ${tier}">${escape(t(item?.rarity_label || '普通'))}</span>`;
}
export function renderCareResult(container, item, text) {
    container.hidden = !item;
    if (!item) { container.replaceChildren(); return; }
    container.innerHTML = `${itemArt(item)}<div>${itemBadge(item)}<strong>${escape(t(item.name))}</strong><p>${escape(text)}</p></div>`;
}

export class CareCollection {
    constructor(dialog, {onDraw,onUse,availability}) {
        this.dialog = dialog; this.onDraw = onDraw; this.onUse = onUse; this.availability = availability;
        this.tab = 'draw'; this.kind = 'food';
        dialog.querySelector('[data-shop-close]').onclick = () => dialog.close();
        dialog.querySelectorAll('[data-shop-tab]').forEach(button => button.onclick = () => { this.tab = button.dataset.shopTab; this.render(); });
        dialog.querySelectorAll('[data-shop-kind]').forEach(button => button.onclick = () => { this.kind = button.dataset.shopKind; this.render(); });
    }
    update({pet,catalog,pending,busy}) {
        this.pet = pet; this.catalog = catalog; this.pending = pending; this.busy = busy;
        if (this.dialog.open) this.render();
    }
    open(tab = 'draw') {
        this.tab = tab; this.render(); this.dialog.showModal();
    }
    result(item, message) {
        renderCareResult(this.dialog.querySelector('[data-shop-result]'), item, message);
    }
    render() {
        if (!this.pet || !this.catalog) return;
        const {pet,catalog,dialog} = this;
        dialog.querySelector('[data-shop-coins]').textContent = Number(pet.pet_coins || 0);
        dialog.querySelectorAll('[data-shop-tab]').forEach(b => { const active = b.dataset.shopTab === this.tab; b.setAttribute('aria-pressed', String(active)); });
        dialog.querySelectorAll('[data-shop-kind]').forEach(b => { b.hidden = this.tab !== 'bag'; b.setAttribute('aria-pressed', String(b.dataset.shopKind === this.kind)); });
        const content = dialog.querySelector('[data-shop-content]');
        content.replaceChildren();
        if (this.tab === 'draw') {
            for (const kind of ['food','toy']) {
                const featured = catalog.items.find(i => i.id === (kind === 'food' ? 'heart_biscuit' : 'star_plush'));
                const cost = catalog.prices[kind], retry = this.pending?.kind === kind;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'care-draw-card';
                button.innerHTML = `${itemArt(featured)}<span><strong>${t(kind === 'food' ? '食物小包' : '玩具禮盒')}</strong><small>${t(kind === 'food' ? '隨機一種食物，共 3 份' : '隨機一款玩具，永久保留')}</small></span><b>${escape(t(retry ? '重試確認結果' : '{n} 金幣', {n:cost}))}</b>`;
                button.disabled = this.busy || (this.pending ? !retry : Number(pet.pet_coins || 0) < cost);
                button.onclick = () => this.onDraw(kind);
                content.append(button);
            }
            const odds = document.createElement('p'); odds.className = 'care-shop-odds';
            odds.textContent = catalog.rarities.map(r => `${t(r.label)} ${Math.round(r.probability*100)}%`).join(' · ');
            content.append(odds);
            const rules = document.createElement('p'); rules.className = 'care-shop-rules';
            rules.textContent = t('先抽等級，再於同等級內等機率抽取。免費基本款不在抽取池。重複玩具返還 20 金幣。');
            content.append(rules);
        } else {
            const items = catalog.items.filter(i => i.kind === this.kind);
            const grid = document.createElement('div'); grid.className = 'care-bag-grid';
            const unlocked = items.filter(i => this.owned(i)).length;
            const note = document.createElement('p'); note.className = 'care-shop-rules';
            note.textContent = t('已備有 {n} / {total} 種', {n:unlocked,total:items.length}); content.append(note);
            for (const item of items) {
                const owned = this.owned(item), base = item.id === catalog.base_food || item.id === catalog.base_toy;
                const quantity = pet.pet_food_inventory?.[item.id] || 0;
                const action = item.kind === 'food' ? 'feed' : 'play';
                const card = document.createElement('article'); card.className = `care-bag-item${owned?'':' is-locked'}`;
                const quantityText = base ? t('基本款 · 隨時可用') : item.kind === 'food' ? t('{n} 份', {n:quantity}) : t(owned?'已收藏 · 可重複使用':'尚未收藏');
                const availability = this.availability(action);
                card.innerHTML = `${itemArt(item)}${itemBadge(item)}<strong>${escape(t(item.name))}</strong><small>${escape(quantityText)}</small><p>${escape(itemEffects(item))}</p>`;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary';
                button.textContent = t(!owned ? '尚未擁有' : availability.disabled ? availability.label : item.kind === 'food' ? '餵一份' : '陪牠玩');
                button.disabled = !owned || availability.disabled;
                button.onclick = () => { dialog.close(); this.onUse(action,item.id); };
                card.append(button); grid.append(card);
            }
            content.append(grid);
        }
    }
    owned(item) {
        return item.id === this.catalog.base_food || item.id === this.catalog.base_toy || (item.kind === 'food'
            ? Number(this.pet.pet_food_inventory?.[item.id] || 0) > 0
            : this.pet.pet_owned_toys?.includes(item.id));
    }
}
