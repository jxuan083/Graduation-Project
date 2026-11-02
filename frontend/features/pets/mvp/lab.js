import { CATALOG, DEFAULT_EQUIPMENT, validateEquipment, toyMarkup } from './catalog.js';
import { RivePet, FramePet } from './renderers.js';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let equipment = { ...DEFAULT_EQUIPMENT };
try { equipment = validateEquipment(JSON.parse(localStorage.getItem('pet-lab-equipment'))); } catch { /* storage is optional */ }
const cards = [...document.querySelectorAll('.pet-card')];
const controllers = new Map();
let disposed = false;
function equipmentAvailability() {
    const disabled = changing || [...controllers.values()].some(c => c.busy);
    document.querySelectorAll('[data-kind]').forEach(button => button.disabled = disabled);
    for (const [card, c] of controllers) card.querySelectorAll('.actions button,.touch-zone,.snack,.toy').forEach(button => button.disabled = changing || c.busy || !c.ready);
}
function fail(card, error) {
    const c = controllers.get(card); if (c) c.ready = false;
    card.querySelector('.engine-status').textContent = '載入失敗';
    card.querySelector('.speech').textContent = error.message;
    card.querySelectorAll('.actions button,.touch-zone,.snack,.toy').forEach(b => b.disabled = true);
}
function emit(card, type) {
    if (reducedMotion.matches) return;
    const layer = card.querySelector('.effects');
    const node = document.createElement('span'); node.className = 'particle'; node.textContent = type === 'feed' ? '· · ·' : '♡';
    if (type === 'play') node.innerHTML = toyMarkup(equipment.toy);
    if (type === 'play') { node.style.width = '40px'; node.style.top = '65%'; node.style.left = '70%'; }
    layer.replaceChildren(node);
    const anim = node.animate(type === 'play' ? [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(-100px,-90px) rotate(-130deg)', opacity: 1, offset: .5 },
        { transform: 'translate(-150px,0) rotate(-260deg)', opacity: 0 },
    ] : [{ transform: 'translate(-10px,0)', opacity: 1 }, { transform: 'translate(12px,-48px)', opacity: 0 }], { duration: 1000, easing: 'ease-out' });
    anim.finished.then(() => node.remove()).catch(() => node.remove());
}
async function act(card, action) {
    const c = controllers.get(card); if (!c?.ready || c.busy || disposed || changing) return;
    c.busy = true; equipmentAvailability();
    const buttons = card.querySelectorAll('.actions button,.snack,.toy'); buttons.forEach(b => b.disabled = true);
    card.querySelector('.speech').textContent = { feed: '啊——我準備好了！', pet: '再摸一下，好舒服。', play: `一起玩${CATALOG.toys[equipment.toy].label}！` }[action];
    try {
        await c.player.setAction(action);
        if (reducedMotion.matches) c.player.still();
        emit(card, action);
        c.timer = setTimeout(async () => {
            if (disposed) return;
            try { await c.player.setAction('idle'); if (reducedMotion.matches) c.player.still(); }
            catch (e) { fail(card, e); c.busy = false; equipmentAvailability(); return; }
            card.querySelector('.speech').textContent = action === 'feed' ? '吃飽了，謝謝你。' : '有你陪著真好。';
            c.busy = false; equipmentAvailability(); buttons.forEach(b => b.disabled = false);
        }, 2200);
    } catch (error) { c.busy = false; equipmentAvailability(); fail(card, error); }
}
function wireSnack(card) {
    const snack = card.querySelector('.snack');
    let drag, lastDragged = false;
    snack.addEventListener('pointerdown', e => {
        if (snack.disabled || e.button !== 0) return;
        snack.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, y: e.clientY, active: false };
    });
    snack.addEventListener('pointermove', e => {
        if (!drag) return;
        if (!drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 7) {
            drag.active = true;
            drag.ghost = snack.cloneNode(true); drag.ghost.removeAttribute('aria-label'); drag.ghost.setAttribute('aria-hidden','true');
            drag.ghost.classList.add('dragging'); document.body.append(drag.ghost);
        }
        if (!drag.active) return;
        drag.ghost.style.left = `${e.clientX}px`; drag.ghost.style.top = `${e.clientY}px`;
        const r = card.querySelector('.art').getBoundingClientRect();
        drag.inside = Math.hypot((e.clientX-r.left)/r.width-.5,(e.clientY-r.top)/r.height-.43)<.18;
        card.querySelector('.speech').textContent = drag.inside ? '就是這裡，放開餵我！' : '把餅乾拿到我的嘴邊。';
    });
    snack.addEventListener('pointerup', () => {
        if (!drag) return;
        const d = drag; drag = null; lastDragged = d.active; d.ghost?.remove();
        if (d.active) {
            if (d.inside) act(card,'feed');
            else card.querySelector('.speech').textContent = '差一點點，再拿近一點。';
        }
    });
    snack.addEventListener('pointercancel', () => { drag?.ghost?.remove(); drag=null; });
    // Keyboard and simple taps have the same accessible action as a successful drop.
    snack.addEventListener('click', e => {
        // Browser-generated click after a drag is suppressed by the moved pointer origin.
        if (e.detail === 0 || !lastDragged) act(card,'feed');
        lastDragged = false;
    });

}
async function init(card) {
    const player = card.dataset.engine === 'rive' ? new RivePet(card.querySelector('canvas')) : new FramePet(card.querySelector('canvas'));
    const c = { player, ready: false, busy: false }; controllers.set(card, c);
    card.querySelectorAll('.actions button,.touch-zone,.snack,.toy').forEach(b => b.disabled = true);
    try {
        await player.load(); await player.setEquipment(equipment);
        if (disposed) { player.dispose(); return; }
        if (reducedMotion.matches) player.still();
        c.ready = true; card.querySelector('.engine-status').textContent = '可以互動';
        card.querySelectorAll('.actions button,.touch-zone,.snack,.toy').forEach(b => b.disabled = false);
        card.querySelectorAll('[data-action]').forEach(b => b.onclick = () => act(card,b.dataset.action));
        card.querySelector('.touch-zone').onclick = () => act(card,'pet');
        card.querySelector('.toy').onclick = () => act(card,'play');
        wireSnack(card);
    } catch (error) { fail(card,error); }
}
function refreshControls() {
    document.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed',String(equipment[b.dataset.kind]===b.dataset.item)));
    cards.forEach(card => card.querySelector('.toy').innerHTML = toyMarkup(equipment.toy));
}
let changing = false;
for (const button of document.querySelectorAll('[data-kind]')) button.onclick = async () => {
    if (changing || [...controllers.values()].some(c => c.busy)) return;
    changing = true; equipmentAvailability();
    equipment = validateEquipment({ ...equipment, [button.dataset.kind]: button.dataset.item });
    refreshControls();
    document.querySelectorAll('[data-kind]').forEach(b => b.disabled = true);
    try {
        await Promise.all([...controllers].map(async ([card,c]) => {
            if (!c.ready) return;
            try { await c.player.setEquipment(equipment); if (reducedMotion.matches) c.player.still(); }
            catch (e) { fail(card,e); c.ready=false; }
        }));
        try { localStorage.setItem('pet-lab-equipment',JSON.stringify(equipment)); } catch { /* private browsing */ }
    } finally { changing=false; equipmentAvailability(); }
};
refreshControls();
// Original photo is a rigid, independently clipped layer; no mesh or AI redraw.
let photoURL, photoVersion = 0;
const photoInput = document.getElementById('portrait'), status = document.getElementById('photo-status');
const zoom = document.getElementById('zoom'), photoX = document.getElementById('photo-x'), photoY = document.getElementById('photo-y');
function positionPhoto() {
    cards.forEach(card => {
        const img = card.querySelector('.portrait-slot img');
        img.style.transform = `translate(${photoX.value}%,${photoY.value}%) scale(${zoom.value})`;
    });
}
for (const input of [zoom,photoX,photoY]) input.oninput = positionPhoto;
photoInput.onchange = async () => {
    const file = photoInput.files[0]; if (!file) return;
    const version = ++photoVersion;
    if (file.size > 20 * 1024 * 1024) { status.textContent='照片請小於 20 MB。'; photoInput.value=''; return; }
    const next = URL.createObjectURL(file), image = new Image(); image.src=next;
    try {
        await image.decode();
        if (version !== photoVersion || disposed) { URL.revokeObjectURL(next); return; }
        if (photoURL) URL.revokeObjectURL(photoURL); photoURL=next;
        zoom.value=1;photoX.value=0;photoY.value=0;positionPhoto();
        cards.forEach(card => { card.querySelector('.portrait-slot img').src=next;card.querySelector('.portrait-slot').hidden=false; });
        status.textContent='已套用原照片，沒有重畫或拉伸五官。可展開下方調整位置，把臉對準開口。';
        document.getElementById('crop-panel').open=true;
    } catch { URL.revokeObjectURL(next); if (version===photoVersion) status.textContent='這張照片無法讀取，請選擇 JPG、PNG 或 WebP。'; }
    finally { photoInput.value=''; }
};
document.getElementById('clear-photo').onclick=()=>{
    ++photoVersion;cards.forEach(card=>{card.querySelector('.portrait-slot').hidden=true;card.querySelector('.portrait-slot img').removeAttribute('src');});
    if(photoURL)URL.revokeObjectURL(photoURL);photoURL=null;
    status.textContent='已移除照片，恢復示範表情。';
};
function choose(value) {
    document.querySelectorAll('[data-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.choice===value)));
    document.getElementById('selection-status').textContent=`已選擇「${value==='rive'?'插畫動起來':'立體小布偶'}」，只記在這台裝置，還沒更換正式寵物。`;
}
for(const button of document.querySelectorAll('[data-choice]'))button.onclick=()=>{choose(button.dataset.choice);try{localStorage.setItem('pet-lab-choice',button.dataset.choice);}catch{}};
try{const choice=localStorage.getItem('pet-lab-choice');if(['rive','frames'].includes(choice))choose(choice);}catch{}
document.addEventListener('visibilitychange',()=>controllers.forEach(c=>{if(c.ready)c.player.pause(document.hidden||reducedMotion.matches);}));
reducedMotion.addEventListener('change',()=>controllers.forEach(c=>{if(c.ready){if(reducedMotion.matches)c.player.still();else{c.player.reduced=false;c.player.pause(document.hidden);}}}));
window.addEventListener('pagehide',()=>{disposed=true;++photoVersion;controllers.forEach(c=>{clearTimeout(c.timer);c.player.dispose();});if(photoURL)URL.revokeObjectURL(photoURL);document.querySelectorAll('.dragging').forEach(e=>e.remove());});
await Promise.all(cards.map(init));
