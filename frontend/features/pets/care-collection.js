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

function buffDescription(buff) {
    if (!buff) return '';
    const labels = { feed_boost:'餵食效果', play_boost:'玩耍效果', all_boost:'全項效果', decay_resist:'衰退抵抗', wipe_boost:'清潔效果' };
    const label = labels[buff.buff_type] || buff.buff_type;
    const val = buff.buff_type === 'decay_resist'
        ? `${Math.round((1 - buff.buff_value) * 100)}%↓`
        : `×${buff.buff_value}`;
    return `${label} ${val} · ${buff.buff_duration_hours}h`;
}

function effectsHtml(item) {
    const eff = itemEffects(item);
    if (!eff) return '';
    const parts = Object.entries(item?.effects || {}).map(([key, n]) => {
        const label = key === 'pet_energy' ? '飽食' : key === 'pet_happiness' ? '快樂' : key;
        const cls = n >= 0 ? 'effect-pos' : 'effect-neg';
        return `<span class="${cls}">${label} ${n > 0 ? '+' : ''}${n}</span>`;
    });
    return `<div class="care-item-effects">${parts.join('')}</div>`;
}
// 每 3 件同款 = 1 張抽獎卷（count/3，無 keep-1 保留）
export function exchangeableSets(count) {
    return Math.max(0, Math.floor(Number(count || 0) / 3));
}
export function formatTickets(tickets) {
    if (tickets && typeof tickets === 'object') {
        return String(Number(tickets.personal || 0));
    }
    return String(tickets ?? 0);
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
    constructor(dialog, {onUse, availability, onEquip, onUnequip, onExchange, onExchangeAll}) {
        this.dialog = dialog; this.onUse = onUse; this.availability = availability;
        this.onEquip = onEquip; this.onUnequip = onUnequip;
        this.onExchange = onExchange; this.onExchangeAll = onExchangeAll;
        this.kind = 'food';
        dialog.querySelector('[data-shop-close]').onclick = () => dialog.close();
        dialog.querySelectorAll('[data-shop-kind]').forEach(button => button.onclick = () => { this.kind = button.dataset.shopKind; this.render(); });
    }
    update({pet, catalog, wardrobe, equipped, tickets}) {
        this.pet = pet; this.catalog = catalog;
        if (wardrobe !== undefined) this.wardrobe = wardrobe;
        if (equipped !== undefined) this.equipped = equipped;
        if (tickets !== undefined) this.tickets = tickets;
        if (this.dialog.open) this.render();
    }
    open() {
        this.selectKind = null;
        this.render(); this.dialog.showModal(); this.dialog.scrollTop = 0;
    }
    choose(kind) {
        this.selectKind = kind; this.kind = kind;
        this.render(); this.dialog.showModal(); this.dialog.scrollTop = 0;
    }
    render() {
        if (!this.pet || !this.catalog) return;
        const { pet, catalog, dialog } = this;
        const choosing = Boolean(this.selectKind);
        dialog.querySelector('[data-shop-close]').setAttribute('aria-label', t(choosing ? '關閉選擇' : '關閉背包'));
        dialog.querySelector('#pet-shop-title').textContent = t(choosing ? (this.kind === 'food' ? '選擇食物' : '選擇玩具') : '背包');
        const descEl = dialog.querySelector('#pet-shop-desc');
        if (descEl) descEl.textContent = t(choosing ? (this.kind === 'food' ? '選一份牠今天想吃的' : '今天想怎麼一起玩？') : '食物、玩具和徽章都在這裡');
        const kindsEl = dialog.querySelector('.care-shop-kinds');
        if (kindsEl) kindsEl.hidden = choosing;
        dialog.querySelectorAll('[data-shop-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shopKind === this.kind)));
        const content = dialog.querySelector('[data-shop-content]');
        content.replaceChildren();
        if (this.kind === 'costume') {
            const wardrobe = this.wardrobe || [];
            const equipped = this.equipped || {};
            const note = document.createElement('p'); note.className = 'care-shop-rules';
            note.textContent = t('已收集 {n} 個徽章', {n: wardrobe.length});
            content.append(note);

            // Ticket count display
            const ticketEl = this.dialog.querySelector('#pet-shop-tickets');
            if (ticketEl && this.tickets !== undefined) ticketEl.textContent = formatTickets(this.tickets);

            if (!wardrobe.length) {
                const empty = document.createElement('p'); empty.className = 'care-bag-empty';
                empty.textContent = t('還沒有任何徽章，快去商城抽扭蛋！');
                content.append(empty); return;
            }

            // "一鍵兌換全部重複" button
            const totalExchangeable = wardrobe.reduce((sum, item) => sum + exchangeableSets(item.count || 1), 0);
            if (totalExchangeable > 0) {
                const exchangeAllBtn = document.createElement('button');
                exchangeAllBtn.type = 'button';
                exchangeAllBtn.className = 'btn primary care-exchange-all-btn';
                exchangeAllBtn.textContent = t('一鍵兌換全部重複 +{n} 張抽獎卷', {n: totalExchangeable});
                exchangeAllBtn.onclick = () => this.onExchangeAll?.('gacha');
                content.append(exchangeAllBtn);
            }

            const grid = document.createElement('div'); grid.className = 'care-bag-grid';
            const rarityLabel = r => r === 'common' ? '普通' : r === 'rare' ? '稀有' : '珍藏';
            for (const item of wardrobe) {
                const isEquipped = equipped[item.slot]?.id === item.id;
                const card = document.createElement('article'); card.className = `care-bag-item${isEquipped ? ' is-equipped' : ''}`;
                const iconSrc = item.img || new URL(`../../assets/pets/gacha/${item.id}.svg`, import.meta.url).href;
                const count = item.count || 1;
                const countBadge = count > 1 ? `<span class="care-count-badge">×${count}</span>` : '';
                const exchangeSets = exchangeableSets(count);
                const exchangeBadge = exchangeSets > 0 ? `<span class="care-exchange-badge">${escape(t('可兌換 {n} 張抽獎卷', {n: exchangeSets}))}</span>` : '';
                const slotLabel = item.slot === 'head' ? '頭部' : item.slot === 'neck' ? '頸部' : item.slot === 'body' ? '身體' : '特效';
                const buffHtml = item.buff
                    ? `<div class="care-item-buff">✨ 啟用：${escape(buffDescription(item.buff))}</div>`
                    : '';
                card.innerHTML = `<span class="care-art care-art-costume" aria-hidden="true"><img src="${escape(iconSrc)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='?'"></span><span class="care-rarity ${item.rarity}">${rarityLabel(item.rarity)}</span><strong>${escape(t(item.name))}</strong>${countBadge}<small>${t(isEquipped ? '已啟用' : slotLabel)}</small>${buffHtml}${exchangeBadge}`;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary';
                button.textContent = t(isEquipped ? '取消' : '啟用');
                button.onclick = () => isEquipped ? this.onUnequip?.(item) : this.onEquip?.(item);
                card.append(button);
                if (exchangeSets > 0) {
                    const exchangeBtn = document.createElement('button');
                    exchangeBtn.type = 'button';
                    exchangeBtn.className = 'btn secondary care-exchange-btn';
                    exchangeBtn.textContent = t('兌換群組抽獎券');
                    exchangeBtn.dataset.itemId = item.id;
                    exchangeBtn.dataset.exchangeSets = String(exchangeSets);
                    exchangeBtn.onclick = () => this.onExchange?.(item, exchangeSets, 'gacha');
                    card.append(exchangeBtn);
                }
                grid.append(card);
            }
            content.append(grid);
        } else {
            const items = catalog.items.filter(i => i.kind === this.kind).sort((a,b) => Number(this.owned(b)) - Number(this.owned(a)));
            const grid = document.createElement('div'); grid.className = 'care-bag-grid';
            const unlocked = items.filter(i => this.owned(i)).length;
            const note = document.createElement('p'); note.className = 'care-shop-rules';
            note.textContent = t('已備有 {n} / {total} 種', {n:unlocked, total:items.length}); content.append(note);

            // "一鍵兌換全部重複玩具" button
            if (this.kind === 'toy') {
                const toyInventory = pet.pet_owned_toys || {};
                const totalToyExchangeable = items.reduce((sum, item) => {
                    const cnt = Number(toyInventory[item.id] || 0);
                    return sum + exchangeableSets(cnt);
                }, 0);
                if (totalToyExchangeable > 0) {
                    const exchangeAllBtn = document.createElement('button');
                    exchangeAllBtn.type = 'button';
                    exchangeAllBtn.className = 'btn primary care-exchange-all-btn';
                    exchangeAllBtn.textContent = t('一鍵兌換全部重複 +{n} 張抽獎卷', {n: totalToyExchangeable});
                    exchangeAllBtn.onclick = () => this.onExchangeAll?.('toy');
                    content.append(exchangeAllBtn);
                }
            }

            for (const item of items) {
                const owned = this.owned(item), base = item.id === catalog.base_food || item.id === catalog.base_toy;
                const quantity = pet.pet_food_inventory?.[item.id] || 0;
                const toyCount = Number((pet.pet_owned_toys || {})[item.id] || 0);
                const action = item.kind === 'food' ? 'feed' : 'play';
                const card = document.createElement('article'); card.className = `care-bag-item${owned ? '' : ' is-locked'}`;
                const countBadge = item.kind === 'toy' && toyCount > 1 ? `<span class="care-count-badge">×${toyCount}</span>` : '';
                const toyExchangeSets = item.kind === 'toy' ? Math.floor(toyCount / 3) : 0;
                const toyExchangeBadge = toyExchangeSets > 0 ? `<span class="care-exchange-badge">${escape(t('可兌換 {n} 張抽獎卷', {n: toyExchangeSets}))}</span>` : '';
                const quantityText = base ? t('基本款 · 無限可用') : item.kind === 'food' ? t('{n} 份', {n:quantity}) : t(owned ? '剩餘 {n} 件 · 用完即失去' : '尚未收藏', {n:toyCount});
                const availability = this.availability(action);
                card.innerHTML = `${itemArt(item)}${itemBadge(item)}<strong>${escape(t(item.name))}</strong>${countBadge}<small>${escape(quantityText)}</small>${effectsHtml(item)}${toyExchangeBadge}`;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary';
                button.textContent = t(!owned ? '尚未擁有' : availability.disabled ? availability.label : item.kind === 'food' ? '餵一份' : '陪牠玩');
                button.disabled = !owned || availability.disabled;
                button.onclick = () => { dialog.close(); this.onUse(action, item.id); };
                card.append(button);
                if (toyExchangeSets > 0) {
                    const exchangeBtn = document.createElement('button');
                    exchangeBtn.type = 'button';
                    exchangeBtn.className = 'btn secondary care-exchange-btn';
                    exchangeBtn.textContent = t('兌換群組抽獎券');
                    exchangeBtn.dataset.itemId = item.id;
                    exchangeBtn.dataset.exchangeSets = String(toyExchangeSets);
                    exchangeBtn.onclick = () => this.onExchange?.(item, toyExchangeSets, 'toy');
                    card.append(exchangeBtn);
                }
                grid.append(card);
            }
            content.append(grid);
        }
    }
    owned(item) {
        return item.id === this.catalog.base_food || item.id === this.catalog.base_toy || (item.kind === 'food'
            ? Number(this.pet.pet_food_inventory?.[item.id] || 0) > 0
            : Number((this.pet.pet_owned_toys || {})[item.id] || 0) > 0);
    }
}
